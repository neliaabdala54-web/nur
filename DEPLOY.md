# Publicar o Bot Nur no Render

## 1. Preparar o GitHub

Envia este projeto existente para um repositório GitHub. Confirma antes de
publicar que `.env`, `.data/`, `node_modules/` e ficheiros de logs não estão
versionados. O ficheiro `.env.example` contém apenas nomes e exemplos de
configuração; não coloques nele uma chave real.

## 2. Criar o serviço no Render

1. No Render, escolhe **New + → Web Service**.
2. Liga a conta GitHub, seleciona o repositório do Bot Nur e a branch a publicar.
3. Escolhe o runtime **Node**.
4. Preenche os comandos:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Não é necessário um comando de build frontend: o próprio servidor serve os
   ficheiros existentes em `public/`.

O Render fornece `PORT`. Em produção, o servidor escuta nessa porta em
`0.0.0.0`; não é preciso definir `HOST`.

## 3. Configurar variáveis de ambiente

Na página do serviço, abre **Environment → Environment Variables** e configura:

```text
GEMINI_API_KEY=COLOCAR_AQUI
NODE_ENV=production
DATA_DIR=/var/data
```

Substitui o valor de `GEMINI_API_KEY` diretamente no painel do Render pela chave
privada da Google AI Studio. Não a coloques no GitHub, neste documento, no código
ou em mensagens/logs. `AI_MODEL` é opcional; sem essa variável, usa-se o modelo
Flash definido pelo projeto. `AI_API_KEY` continua aceite apenas para instalações
antigas.

Não é necessária `SEARCH_API_KEY`: as perguntas atuais usam Google Search
Grounding através da mesma integração Gemini.

## 4. Preservar utilizadores e histórico

O Bot Nur guarda contas, sessões, conversas, mensagens e memória em
`bot-nur.sqlite`. O sistema cria o esquema se ainda não existir e reutiliza a
base encontrada no diretório configurado; não apagues esse ficheiro.

Para manter os dados entre reinícios e novos deploys:

1. Adiciona um **Persistent Disk** ao serviço (disponível em planos Render que
   suportam discos persistentes).
2. Usa `/var/data` como **Mount Path**, igual ao `DATA_DIR` acima.
3. Mantém o mesmo disco associado ao serviço nas atualizações futuras.

Sem um Persistent Disk, o armazenamento do Web Service é efémero: uma
reinicialização ou novo deploy pode apagar contas, sessões e histórico. O SQLite
é adequado a uma única instância do serviço; não aumentes para várias instâncias
partilhando este ficheiro. Uma configuração multi-instância exige uma base de
dados de servidor e uma migração planeada, que este projeto ainda não implementa.

## 5. Fazer deploy e acompanhar

Guarda as variáveis, cria o serviço e acompanha o primeiro deploy em **Events**.
Em **Logs**, verifica a instalação e a linha de arranque do servidor. Os logs não
devem conter valores de variáveis secretas; se detetares uma credencial, revoga-a
no fornecedor e substitui-a no Render.

## 6. Testar a publicação

Depois de o deploy ficar disponível:

1. Abre `https://<dominio-do-servico>/health`; a resposta esperada é
   `{"status":"ok"}`.
2. Abre a página inicial do mesmo domínio e cria uma conversa.
3. Testa uma pergunta geral, por exemplo `Ajuda-me com um trabalho escolar.`
4. Testa a base local com `Quais farmácias existem em Maxixe?`
5. Testa uma pergunta atual, por exemplo `Quem é o atual Presidente de
   Moçambique?`; confirma que a resposta inclui fontes quando o Grounding as
   fornecer. Se não houver fontes verificáveis, o Bot Nur deve declarar que não
   conseguiu confirmar.
6. Cria uma conta e uma conversa, reinicia o serviço e confirma que os dados
   continuam disponíveis quando o Persistent Disk está montado.

O frontend, a API e a rota de saúde usam o mesmo domínio; não é preciso publicar
o frontend separadamente no GitHub Pages.
