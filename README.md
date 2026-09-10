# 🏎️ Moment Motorsport

Audiovisual Production Platform

---

## 🚀 Deploy no Render

### ✅ O que fazer:

1. **Extraia este ZIP** no seu computador
2. **Copie seus arquivos HTML/CSS/JS** para a raiz do projeto ou pasta `public/`
3. **Faça o push para o GitHub:**

```bash
git add .
git commit -m "Deploy inicial no Render"
git push
```

4. **No Render:**
   - Vá em render.com
   - Clique em "New" → "Web Service"
   - Conecte seu GitHub
   - Selecione o repo
   - Clique em "Create Web Service"
   - Pronto! 🎉

---

## 📁 Estrutura de Pastas

```
momento/
├── public/          ← Coloque seus arquivos HTML aqui (opcional)
├── index.html       ← Página principal
├── package.json     ← Configuração do Node
├── server.js        ← Servidor Express
├── render.yaml      ← Config automática do Render
├── .gitignore       ← Arquivos a ignorar no Git
└── README.md        ← Este arquivo
```

---

## 🛠️ Testar Localmente

```bash
# Instalar dependências
npm install

# Rodar servidor
npm start

# Acessar em: http://localhost:3000
```

---

## 📝 Notas Importantes

- ✅ O `server.js` serve arquivos estáticos automaticamente
- ✅ Se tiver `index.html` na raiz, ele serve esse
- ✅ Compatível com React, Vue, Plain HTML, etc
- ✅ CORS habilitado para requisições externas

---

**Dúvidas?** Consulte a [documentação do Render](https://render.com/docs)
