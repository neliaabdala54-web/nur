# Guia de Deploy e Publicação do Bot Nur

Este documento explica como publicar o **Bot Nur** no **GitHub Pages** (Frontend) e num **servidor Node.js** (Backend, ex.: Render).

---

## 1. Arquitetura de Publicação

```text
               +----------------------------------+
               |        GITHUB PAGES              |
               |  https://neliaabdala54-web.github.io/nur/
               |  (Frontend HTML / CSS / JS)      |
               +-----------------+----------------+
                                 |
                          Chamadas à API
                                 |
                                 v
               +----------------------------------+
               |         SERVIDOR BACKEND         |
               |     (Render / Railway / VPS)     |
               | Node.js + SQLite + Gemini API    |
               +----------------------------------+
```

- **Frontend (GitHub Pages):** Publica a interface do utilizador contida em `public/` através de um build gerado em `dist/`.
- **Backend (Node.js / Render):** Executa `server.mjs`, processa pedidos de IA via Gemini, gere a base de dados SQLite e trata uploads multimodais.

---

## 2. Publicação do Frontend no GitHub Pages

A publicação é feita automaticamente pelo **GitHub Actions** em cada `git push` para a branch `master`.

### Como Funciona:
1. O workflow `.github/workflows/deploy.yml` é executado ao fazer push na branch `master`.
2. Instala dependências e executa a suíte de testes (`npm test`).
3. Executa o comando de build (`npm run build`), que compila o site estático para a pasta `dist/` e insere o ficheiro `.nojekyll`.
4. O GitHub Actions publica automaticamente o conteúdo da pasta `dist/` no **GitHub Pages** em:
   **https://neliaabdala54-web.github.io/nur/**

### Configuração no GitHub:
No repositório do GitHub:
1. Acede a **Settings → Pages**.
2. Em **Build and deployment → Source**, seleciona **GitHub Actions**.

---

## 3. Ligar o Frontend ao Backend (API Base)

No site do GitHub Pages (`https://neliaabdala54-web.github.io/nur/`):
1. Clica no ícone de **Definições** (canto inferior esquerdo no menu).
2. Na secção **Servidor da API**, insere o URL do backend (ex.: `https://bot-nur.onrender.com`).
3. Guarda as alterações. A aplicação utilizará este servidor para processar mensagens, sessões e memória.

Alternativamente, podes injetar a variável global no HTML se desejares um backend pré-definido:
```html
<script>window.BOT_NUR_API_BASE = "https://teu-backend.onrender.com";</script>
```

---

## 4. Publicação do Backend no Render (ou outro alojamento Node.js)

### Passos no Render:
1. Cria um novo **Web Service** no Render ligado ao repositório GitHub.
2. Seleciona o runtime **Node**.
3. Configura os comandos:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Na secção **Environment Variables**, adiciona:
   ```text
   GEMINI_API_KEY=tua_chave_gemini_aqui
   NODE_ENV=production
   DATA_DIR=/var/data
   ```
5. Para manter os utilizadores e o histórico entre deploys, adiciona um **Persistent Disk** montado em `/var/data`.

---

## 5. Comandos Locais

- **Executar aplicação localmente:** `npm start`
- **Executar testes:** `npm test`
- **Executar build do frontend:** `npm run build`
