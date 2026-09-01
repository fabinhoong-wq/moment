// Moment Motorsport — Sistema de Gestão
// Servidor local com persistência em JSON
// Uso: node servidor.js  →  abrir http://localhost:3030

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

const PORT      = 3030;
const DATA_FILE = path.join(__dirname, 'moment-data.json');

// ── Estado padrão ────────────────────────────────────────────────────
const DEFAULT_STATE = {
  projetos:    [],
  lancamentos: [],
  propostas:   [],
  packs: [
    { id:'build', nome:'The Build',  cat:'Projeto de carro',     preco:700,
      itens:['1 vídeo completo de até 5 minutos','Formato cinema, entrevista ou cobertura','1 teaser do vídeo completo','1 Reel para Instagram','The Underground Box inclusa'] },
    { id:'brand', nome:'The Brand',  cat:'Empresas e marcas',    preco:1800,
      itens:['2 dias de captação','4 vídeos em formato YouTube','4 Reels para Instagram','The Underground Box inclusa'] },
    { id:'event', nome:'The Event',  cat:'Cobertura de eventos', preco:2200,
      itens:['Cobertura total do evento','1 vídeo completo do evento','1 teaser do evento','Vídeos brutos para uso posterior','Imagens de drone'] },
  ],
  avulsos: [
    { id:'a1', nome:'Drone adicional',       preco:350, desc:'Sessão extra de drone' },
    { id:'a2', nome:'Vídeo adicional',       preco:250, desc:'Vídeo extra no mesmo projeto' },
    { id:'a3', nome:'Edição urgente',        preco:200, desc:'Entrega em até 48h' },
    { id:'a4', nome:'Patrocínio / Ativação', preco:800, desc:'Ativação de marca em evento' },
  ],
  metas: { Jan:2000,Fev:2000,Mar:2000,Abr:2000,Mai:2000,Jun:2000,Jul:2000,Ago:2000,Set:2000,Out:2000,Nov:2000,Dez:2000 },
  custosFixos: [
    { id:'cf1', nome:'Verificado', valor:120.00 },
    { id:'cf2', nome:'Apple',      valor:19.90 },
    { id:'cf3', nome:'Claude',     valor:115.00 },
  ],
  // Modelos de proposta reutilizáveis (valores padrão da Moment)
  templates: [
    { id:'tpl-evento', nome:'Cobertura de Evento', tipo:'evento',
      desc:'Três níveis de cobertura — padrão para organizadores de evento.',
      niveis:[
        { nome:'Completo',      preco:1790, itens:['1 vídeo chamada (até 1 min)','Captação com drone','2 câmeras cobrindo áreas diferentes','Cobertura fotográfica','Vídeo de cobertura completo'] },
        { nome:'Intermediário', preco:1390, itens:['1 vídeo chamada (até 1 min)','2 câmeras cobrindo áreas diferentes','Cobertura fotográfica','Vídeo de cobertura completo'] },
        { nome:'Essencial',     preco:1000, itens:['1 vídeo chamada (até 1 min)','1 câmera em campo','Vídeo de cobertura completo'] },
      ] },
  ],
  config: { bg:'garagem', accent:'laranja', veil:62, blur:0, scan:true, grid:true, grain:true, custom:'' },
  clientes:   [],
  eventos:    [],
  propNumero: 1,
  nextId:     1,
  _version:   0,
};

let STATE = JSON.parse(JSON.stringify(DEFAULT_STATE));

// ── Persistência ─────────────────────────────────────────────────────
function saveState() {
  try {
    STATE._savedAt = new Date().toISOString();
    STATE._version = (STATE._version || 0) + 1;
    fs.writeFileSync(DATA_FILE, JSON.stringify(STATE, null, 2));
  } catch(e) { console.error('Erro ao salvar:', e.message); }
}

function loadState() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    STATE = Object.assign({}, DEFAULT_STATE, d);
    if (!STATE.packs       || !STATE.packs.length)       STATE.packs       = DEFAULT_STATE.packs;
    if (!STATE.avulsos     || !STATE.avulsos.length)     STATE.avulsos     = DEFAULT_STATE.avulsos;
    if (!STATE.metas)                                    STATE.metas       = DEFAULT_STATE.metas;
    if (!STATE.custosFixos || !STATE.custosFixos.length) STATE.custosFixos = DEFAULT_STATE.custosFixos;
    if (!STATE.templates   || !STATE.templates.length)   STATE.templates   = DEFAULT_STATE.templates;
    if (!STATE.config) STATE.config = DEFAULT_STATE.config;
    if (!STATE.clientes)                                 STATE.clientes    = [];
    if (!STATE.eventos)                                  STATE.eventos     = [];
    console.log('  Dados carregados:');
    console.log('    Projetos:    ' + STATE.projetos.length);
    console.log('    Clientes:    ' + STATE.clientes.length);
    console.log('    Lançamentos: ' + STATE.lancamentos.length);
    console.log('    Propostas:   ' + STATE.propostas.length);
    console.log('    Captações:   ' + STATE.eventos.length);
  } catch(e) {
    console.log('  Nenhum dado salvo — iniciando com dados padrão.');
  }
}

// ── IP local ──────────────────────────────────────────────────────────
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

// ── Ler body ─────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
  });
}

// ── Servidor ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // index.html
  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('index.html não encontrado'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // GET /state
  if (pathname === '/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(STATE));
    return;
  }

  // PATCH /state
  if (pathname === '/state' && req.method === 'PATCH') {
    try {
      const { op, payload } = JSON.parse(await readBody(req));

      switch (op) {
        // PROJETOS
        case 'add-projeto':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'P' + String(STATE.nextId).padStart(4, '0');
          STATE.projetos.push(payload);
          break;
        case 'update-projeto': {
          const i = STATE.projetos.findIndex(x => x.id === payload.id);
          if (i !== -1) STATE.projetos[i] = Object.assign({}, STATE.projetos[i], payload);
          break;
        }
        case 'delete-projeto':
          STATE.projetos = STATE.projetos.filter(x => x.id !== payload.id);
          break;

        // LANÇAMENTOS
        case 'add-lancamento':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'L' + String(STATE.nextId).padStart(4, '0');
          STATE.lancamentos.push(payload);
          break;
        case 'delete-lancamento':
          STATE.lancamentos = STATE.lancamentos.filter(x => x.id !== payload.id);
          break;

        // PROPOSTAS
        case 'add-proposta':
          STATE.nextId     = (STATE.nextId || 1) + 1;
          STATE.propNumero = (STATE.propNumero || 1) + 1;
          payload.id     = 'Q' + String(STATE.nextId).padStart(4, '0');
          payload.numero = STATE.propNumero;
          STATE.propostas.push(payload);
          break;
        case 'update-proposta': {
          const i = STATE.propostas.findIndex(x => x.id === payload.id);
          if (i !== -1) STATE.propostas[i] = Object.assign({}, STATE.propostas[i], payload);
          break;
        }
        case 'delete-proposta':
          STATE.propostas = STATE.propostas.filter(x => x.id !== payload.id);
          break;

        // CONFIGURAÇÃO / PERSONALIZAÇÃO
        case 'set-config':
          STATE.config = Object.assign({}, STATE.config || {}, payload);
          break;

        // TEMPLATES DE PROPOSTA
        case 'add-template':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'tpl' + String(STATE.nextId).padStart(4, '0');
          if (!STATE.templates) STATE.templates = [];
          STATE.templates.push(payload);
          break;
        case 'update-template': {
          const i = (STATE.templates||[]).findIndex(x => x.id === payload.id);
          if (i !== -1) STATE.templates[i] = Object.assign({}, STATE.templates[i], payload);
          break;
        }
        case 'delete-template':
          STATE.templates = (STATE.templates||[]).filter(x => x.id !== payload.id);
          break;

        // PACKS
        case 'add-pack':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'pk' + String(STATE.nextId).padStart(4, '0');
          STATE.packs.push(payload);
          break;
        case 'update-pack': {
          const i = STATE.packs.findIndex(x => x.id === payload.id);
          if (i !== -1) STATE.packs[i] = Object.assign({}, STATE.packs[i], payload);
          break;
        }
        case 'delete-pack':
          STATE.packs = STATE.packs.filter(x => x.id !== payload.id);
          break;

        // AVULSOS
        case 'add-avulso':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'av' + String(STATE.nextId).padStart(4, '0');
          STATE.avulsos.push(payload);
          break;
        case 'delete-avulso':
          STATE.avulsos = STATE.avulsos.filter(x => x.id !== payload.id);
          break;

        // CLIENTES
        case 'add-cliente':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'C' + String(STATE.nextId).padStart(4, '0');
          STATE.clientes.push(payload);
          break;
        case 'update-cliente': {
          const i = STATE.clientes.findIndex(x => x.id === payload.id);
          if (i !== -1) STATE.clientes[i] = Object.assign({}, STATE.clientes[i], payload);
          break;
        }
        case 'delete-cliente':
          STATE.clientes = STATE.clientes.filter(x => x.id !== payload.id);
          break;

        // EVENTOS / CAPTAÇÕES
        case 'add-evento':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'E' + String(STATE.nextId).padStart(4, '0');
          STATE.eventos.push(payload);
          break;
        case 'delete-evento':
          STATE.eventos = STATE.eventos.filter(x => x.id !== payload.id);
          break;

        // CUSTOS FIXOS
        case 'add-custofixo':
          STATE.nextId = (STATE.nextId || 1) + 1;
          payload.id = 'cf' + String(STATE.nextId).padStart(4, '0');
          if (!STATE.custosFixos) STATE.custosFixos = [];
          STATE.custosFixos.push(payload);
          break;
        case 'update-custofixo': {
          const i = (STATE.custosFixos||[]).findIndex(x => x.id === payload.id);
          if (i !== -1) STATE.custosFixos[i] = Object.assign({}, STATE.custosFixos[i], payload);
          break;
        }
        case 'delete-custofixo':
          STATE.custosFixos = (STATE.custosFixos||[]).filter(x => x.id !== payload.id);
          break;

        // METAS
        case 'set-metas':
          STATE.metas = Object.assign({}, STATE.metas, payload);
          break;

        // IMPORT (restaura backup completo)
        case 'import-all':
          STATE = Object.assign({}, DEFAULT_STATE, payload);
          break;

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'op desconhecida: ' + op }));
          return;
      }

      saveState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: payload ? payload.id : null, numero: payload ? payload.numero : null, version: STATE._version }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Não encontrado');
});

// ── Init ──────────────────────────────────────────────────────────────
loadState();

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('==========================================================');
  console.log('     Moment Motorsport - Sistema de Gestao');
  console.log('==========================================================');
  console.log('  Abra no navegador:  http://localhost:' + PORT);
  if (localIP) console.log('  Na rede local:     http://' + localIP + ':' + PORT);
  console.log('  Dados salvos em:    moment-data.json');
  console.log('  Ctrl+C para encerrar');
  console.log('==========================================================');
  console.log('');
});
