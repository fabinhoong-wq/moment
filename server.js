// Moment Motorsport — Sistema de Gestão
// Servidor Express com persistência real em Postgres (Neon/Supabase).
//
// Nesta versão, além de salvar o estado (clientes, projetos, propostas,
// financeiro, agenda, pacotes, metas), o servidor ganhou duas coisas
// novas, no mesmo esquema já usado no AV Manager:
//
//   1) Importação de eventos do Google Calendar via link iCal.
//      Igual ao AV Manager: você cola o "endereço secreto no formato
//      iCal" do seu Google Calendar, clica em Importar, e os eventos
//      viram itens na Agenda. É manual, sob demanda, e só numa direção
//      (Google → Sistema). Nada é escrito de volta no Google Calendar.
//
//   2) Relatório diário por e-mail, disparado de fora (GitHub Actions
//      às 18h, mesmo mecanismo do AV Manager) batendo numa rota
//      protegida por senha. O servidor monta o resumo do dia a partir
//      do que está salvo no banco e manda por Gmail (SMTP + senha de
//      app, não sua senha normal).

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.use(express.static('.'));

// ---- Conexão com o Postgres ----
if (!process.env.DATABASE_URL) {
  console.error('ERRO: variável de ambiente DATABASE_URL não configurada.');
  console.error('Configure em Render → seu serviço → Environment.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function garantirTabelas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moment_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT somente_uma_linha CHECK (id = 1)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moment_config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );
  `);
}

// =====================================================================
// ESTADO DO SISTEMA
// =====================================================================

app.get('/api/state', async (req, res) => {
  try {
    const r = await pool.query('SELECT dados, atualizado_em FROM moment_state WHERE id = 1');
    if (r.rows.length === 0) return res.json({ dados: {}, atualizado_em: null });
    res.json({ dados: r.rows[0].dados, atualizado_em: r.rows[0].atualizado_em });
  } catch (err) {
    console.error('Erro ao ler estado:', err.message);
    res.status(500).json({ erro: 'Não foi possível ler os dados salvos.' });
  }
});

app.post('/api/state', async (req, res) => {
  try {
    const dados = req.body;
    if (!dados || typeof dados !== 'object') {
      return res.status(400).json({ erro: 'Corpo da requisição precisa ser um objeto JSON.' });
    }
    await pool.query(
      `INSERT INTO moment_state (id, dados, atualizado_em)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET dados = $1, atualizado_em = now()`,
      [dados]
    );
    res.json({ ok: true, atualizado_em: new Date().toISOString() });
  } catch (err) {
    console.error('Erro ao salvar estado:', err.message);
    res.status(500).json({ erro: 'Não foi possível salvar os dados.' });
  }
});

app.get('/state', (req, res) => res.redirect(307, '/api/state'));

// =====================================================================
// GOOGLE CALENDAR — importação via link iCal (igual ao AV Manager)
// =====================================================================

app.get('/api/gcal-config', async (req, res) => {
  try {
    const r = await pool.query(`SELECT valor FROM moment_config WHERE chave = 'ical_url'`);
    res.json({ icalUrl: r.rows.length ? r.rows[0].valor : '' });
  } catch (err) {
    res.status(500).json({ erro: 'Não consegui ler a configuração.' });
  }
});

app.post('/api/gcal-config', async (req, res) => {
  try {
    const { icalUrl } = req.body || {};
    await pool.query(
      `INSERT INTO moment_config (chave, valor) VALUES ('ical_url', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = $1`,
      [icalUrl || '']
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Não consegui salvar o link.' });
  }
});

// Parser de iCal simples, sem depender de biblioteca externa. Um
// arquivo .ics é uma lista de blocos VEVENT com linhas tipo
// "SUMMARY:...", "DTSTART:...". As linhas podem vir "dobradas" (uma
// linha continua na próxima, se ela começar com espaço) — isso é
// tratado no unfold abaixo.
function parseICS(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const events = [];
  let cur = null;

  function decode(v) {
    return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
  }
  function parseDate(v) {
    v = v.trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
    if (!m) return { date: '', time: '' };
    const [, y, mo, d, h, mi] = m;
    return { date: `${y}-${mo}-${d}`, time: h ? `${h}:${mi}` : '' };
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (key === 'SUMMARY') cur.summary = decode(value);
    else if (key === 'LOCATION') cur.location = decode(value);
    else if (key === 'DESCRIPTION') cur.desc = decode(value);
    else if (key === 'DTSTART') Object.assign(cur, parseDate(value));
  }
  return events.filter((e) => e.summary && e.date);
}

app.post('/api/import-gcal', async (req, res) => {
  try {
    const { icalUrl } = req.body || {};
    if (!icalUrl) return res.status(400).json({ ok: false, error: 'Cole o link iCal.' });
    const r = await fetch(icalUrl);
    if (!r.ok) return res.status(400).json({ ok: false, error: 'Não consegui abrir esse link (confira se é o link secreto em formato iCal).' });
    const text = await r.text();
    const events = parseICS(text);
    res.json({ ok: true, events, total: events.length });
  } catch (err) {
    console.error('Erro ao importar iCal:', err.message);
    res.status(500).json({ ok: false, error: 'Erro ao buscar ou ler o calendário.' });
  }
});

// =====================================================================
// RELATÓRIO DIÁRIO POR E-MAIL — mesmo esquema do AV Manager: um
// disparador externo (GitHub Actions, 18h) chama esta rota protegida
// por senha; o servidor monta o e-mail e envia via Gmail.
// =====================================================================

function brl(v) {
  v = Number(v) || 0;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function montarRelatorioHtml(dados) {
  const hoje = new Date().toISOString().slice(0, 10);
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const projetos = dados.projetos || [];
  const propostas = dados.propostas || [];
  const financeiro = dados.financeiro || [];
  const agenda = dados.agenda || [];

  const concluidosHoje = projetos.filter((p) => p.etapa === 'Entregue');
  const emAberto = projetos.filter((p) => p.etapa !== 'Entregue');
  const propostasAbertas = propostas.filter((p) => p.status === 'Enviada' || p.status === 'Em negociação');
  const lancHoje = financeiro.filter((f) => f.data === hoje);
  const entradasHoje = lancHoje.filter((f) => f.tipo === 'Entrada').reduce((s, f) => s + (f.valor || 0), 0);
  const saidasHoje = lancHoje.filter((f) => f.tipo === 'Saída').reduce((s, f) => s + (f.valor || 0), 0);
  const entradasTotais = financeiro.filter((f) => f.tipo === 'Entrada').reduce((s, f) => s + (f.valor || 0), 0);
  const saidasTotais = financeiro.filter((f) => f.tipo === 'Saída').reduce((s, f) => s + (f.valor || 0), 0);
  const agendaAmanha = agenda.filter((a) => a.data === amanha);

  // Cor explícita em CADA elemento, nunca por herança — o Gmail (e a
  // maioria dos webmails) frequentemente ignora cor herdada do pai
  // dentro do corpo do e-mail, então sem isso os números somem sem
  // contraste na caixa de entrada real, mesmo aparecendo certo aqui
  // no preview local.
  const C = '#F3F2ED';
  const li = (items, render, vazio) =>
    (items.length ? items.map(render).join('') : `<li style="color:#888">${vazio}</li>`);

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0b;color:${C};padding:28px">
    <div style="font-size:11px;letter-spacing:.2em;color:#FF6B35;text-transform:uppercase;margin-bottom:4px">Moment · Resumo do dia</div>
    <h1 style="font-size:22px;margin:0 0 20px;color:${C}">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</h1>

    <h3 style="color:#3ddc84;font-size:13px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #222;padding-bottom:6px">Concluídos</h3>
    <ul style="padding-left:18px;margin:8px 0 20px;font-size:14px;color:${C}">
      ${li(concluidosHoje, (p) => `<li style="color:${C}">${p.titulo} — ${p.clienteNome || 'sem cliente'}</li>`, 'Nada entregue ainda nesta temporada.')}
    </ul>

    <h3 style="color:#FF6B35;font-size:13px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #222;padding-bottom:6px">Em aberto (${emAberto.length})</h3>
    <ul style="padding-left:18px;margin:8px 0 20px;font-size:14px;color:${C}">
      ${li(emAberto, (p) => `<li style="color:${C}">${p.titulo} — <span style="color:#aaa">${p.etapa}</span></li>`, 'Nenhum projeto em andamento.')}
    </ul>

    <h3 style="color:${C};font-size:13px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #222;padding-bottom:6px">Propostas em aberto (${propostasAbertas.length})</h3>
    <ul style="padding-left:18px;margin:8px 0 20px;font-size:14px;color:${C}">
      ${li(propostasAbertas, (p) => `<li style="color:${C}">${p.cliente} — <span style="color:${C}">${brl(p.valor)}</span> <span style="color:#aaa">(${p.status})</span></li>`, 'Nenhuma proposta em aberto.')}
    </ul>

    <h3 style="color:#E0202C;font-size:13px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #222;padding-bottom:6px">Financeiro</h3>
    <table style="width:100%;font-size:14px;margin:8px 0 20px;border-collapse:collapse;color:${C}">
      <tr><td style="padding:4px 0;color:#aaa">Entradas hoje</td><td style="text-align:right;color:${C}">${brl(entradasHoje)}</td></tr>
      <tr><td style="padding:4px 0;color:#aaa">Saídas hoje</td><td style="text-align:right;color:${C}">${brl(saidasHoje)}</td></tr>
      <tr><td style="padding:6px 0 0;color:#aaa;border-top:1px solid #222">Saldo total acumulado</td><td style="text-align:right;padding-top:6px;color:${C};border-top:1px solid #222;font-weight:bold">${brl(entradasTotais - saidasTotais)}</td></tr>
    </table>

    <h3 style="color:${C};font-size:13px;text-transform:uppercase;letter-spacing:.1em;border-bottom:1px solid #222;padding-bottom:6px">Amanhã na agenda</h3>
    <ul style="padding-left:18px;margin:8px 0 4px;font-size:14px;color:${C}">
      ${li(agendaAmanha, (a) => `<li style="color:${C}">${a.hora || ''} — ${a.titulo}</li>`, 'Nada agendado pra amanhã.')}
    </ul>

    <div style="margin-top:26px;padding-top:14px;border-top:1px solid #222;font-size:11px;color:#777">Moment Motorsport · gerado automaticamente às 18h</div>
  </div>`;
}

app.get('/send-daily-report', async (req, res) => {
  try {
    const secret = req.query.secret || req.headers['x-report-secret'];
    if (!process.env.REPORT_SECRET || secret !== process.env.REPORT_SECRET) {
      return res.status(401).json({ erro: 'Não autorizado.' });
    }
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return res.status(500).json({ erro: 'GMAIL_USER/GMAIL_APP_PASSWORD não configurados.' });
    }

    const r = await pool.query('SELECT dados FROM moment_state WHERE id = 1');
    const dados = r.rows.length ? r.rows[0].dados : {};
    const html = montarRelatorioHtml(dados);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: `"Moment · Sistema de Gestão" <${process.env.GMAIL_USER}>`,
      to: process.env.REPORT_TO || process.env.GMAIL_USER,
      subject: `Moment · Resumo do dia — ${new Date().toLocaleDateString('pt-BR')}`,
      html,
    });

    console.log('Relatório diário enviado com sucesso.');
    res.json({ ok: true, enviado_em: new Date().toISOString() });
  } catch (err) {
    console.error('Erro ao enviar relatório:', err.message);
    res.status(500).json({ erro: 'Falha ao enviar o relatório: ' + err.message });
  }
});

// ---- Página principal ----
app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html', {}, function (error) {
    if (error) res.status(500).send('Error');
  });
});

// ---- Sobe o servidor ----
garantirTabelas()
  .then(() => {
    app.listen(port, () => {
      console.log(`Moment rodando na porta ${port}`);
      console.log(process.env.DATABASE_URL ? 'Banco conectado.' : 'AVISO: sem DATABASE_URL, o /api/state vai falhar.');
    });
  })
  .catch((err) => {
    console.error('Não consegui preparar as tabelas no banco:', err.message);
    app.listen(port, () => console.log(`Moment rodando na porta ${port} (SEM banco funcionando)`));
  });
