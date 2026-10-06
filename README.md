# Bot Nur

Assistente de conversação focado em jovens e adultos em Moçambique, com ênfase
em Maxixe e Inhambane. Inclui uma interface responsiva, utilizadores, histórico
persistente e um modo de respostas local que funciona sem serviços externos.

## Executar

Requisitos: Node.js 22.13 ou superior. Não é preciso instalar dependências.

```powershell
npm.cmd start
```

Abre [http://localhost:3000](http://localhost:3000). Os dados SQLite são
guardados em `.data/bot-nur.sqlite`. O modo visitante permite começar uma
conversa de imediato; cria uma conta para teres as tuas próprias conversas e
poderes voltar a entrar. Para iniciar rapidamente uma conversa, usa o botão
«Nova conversa» ou o atalho `Alt+N`.

Para executar a aplicação em desenvolvimento, com reinício ao alterar os
ficheiros do servidor:

```powershell
npm.cmd run dev
```

## Integração com a IA Gemini

Copia `.env.example` para `.env` e configura `GEMINI_API_KEY` com uma chave da
Gemini. `AI_API_KEY` permanece suportada para instalações existentes. O endpoint
compatível com OpenAI e o modelo Gemini Flash já estão
predefinidos. O pedido usa raciocínio de baixo esforço para reduzir a latência
nas respostas. Mantém as credenciais apenas no `.env`; nunca as adiciones ao
código nem a ficheiros versionados. Sem uma chave válida, o Bot Nur usa as
respostas locais. As perguntas sobre Maxixe incluem também o ficheiro de
conhecimento local.

Perguntas sobre cargos atuais, notícias e outros assuntos que mudam ativam a
ferramenta oficial Google Search Grounding da Gemini. As referências devolvidas
pela ferramenta são mantidas na resposta. Sem chave, sem resultados citados ou
quando o serviço falha, o Bot Nur declara que não conseguiu verificar; não usa
uma resposta sem fontes como confirmação atual.

Em desenvolvimento, o servidor escuta em `127.0.0.1`; em produção escuta em
`0.0.0.0` e aceita a porta `PORT` fornecida pela plataforma. Define
`NODE_ENV=production` para cookies `Secure`. O endpoint simples de saúde é
`/health`. Para publicar no Render e preservar utilizadores e conversas,
consulta [DEPLOY.md](./DEPLOY.md).

## Base Oficial de Maxixe

Quando disponível, `Bot_Nur_Maxixe_Base_Tecnica_v1.json` é a fonte estruturada
principal. O servidor procura primeiro esse nome na raiz do projeto e depois
em `knowledge/`. Mantém `knowledge/maxixe.json` como fonte suplementar: não é
substituída nem apagada. Se o ficheiro técnico v1 não estiver presente, o
servidor regista um aviso e mantém a base oficial local existente em
`knowledge/maxixe-official.json`.

A fonte técnica pode usar nomes de campos em português ou inglês, incluindo
chaves como `plus_code` e `data_verificacao`; a camada de pesquisa normaliza
esses nomes sem preencher os valores ausentes. Campos não fornecidos continuam
desconhecidos. Estados como `A_CONFIRMAR` e `TEMPORARIAMENTE_FECHADO` são
normalizados para filtragem, e os registos fechados ou duplicados não são
apresentados como opções disponíveis.

`knowledge/maxixe-official.json` é a cópia estruturada anteriormente derivada
do documento Word `Base_de_Dados_Oficial_Bot_Nur_Maxixe_Etapas_1_a_12_PARTE_12.docx`.
O importador converte as tabelas de estabelecimentos e factos locais sem
modificar o documento fonte; os valores originais de cada linha ficam em
`recordProvenance.sourceValues`. A importação não significa que contactos,
horários ou outros dados dinâmicos tenham sido verificados.

Para regenerar o JSON a partir do documento fonte, na raiz do projeto executa:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\import-maxixe-official.ps1
```

O servidor combina a fonte principal carregada com `knowledge/maxixe.json` sem
apagar os factos suplementares existentes. Com Gemini configurada, a mensagem
local é primeiro convertida em intenção e filtros estruturados; só depois o
servidor pesquisa o JSON. A saída do interpretador é validada contra categorias,
estados e locais mencionados, e nunca contém resultados. A pesquisa indexada
ordena correspondências por relevância, estado, confiabilidade e data de
verificação; pedidos de locais «abertos» filtram pelo estado ATIVO registado,
sem afirmar disponibilidade em tempo real. Para perguntas
sobre estabelecimentos, a Gemini recebe apenas os resultados recuperados e
devolve IDs autorizados; o servidor valida esses IDs e constrói a resposta com
os valores originais do JSON. Para perguntas factuais locais, envia apenas os
factos correspondentes. Assim, texto livre gerado pelo modelo não pode
preencher campos ausentes nem apresentar registos não recuperados.

Perguntas sobre informação que muda (horários, preços, contactos, eventos,
empregos, promoções, disponibilidade, transportes, notícias e funcionamento)
são distinguidas de perguntas históricas ou culturais estáveis. Quando
Gemini está configurada, o servidor solicita ao Google Search Grounding uma
resposta fundamentada e preserva os URLs/títulos de origem disponibilizados pela
API. Só uma resposta acompanhada por fontes citadas pode sustentar informação
atual; falta de fontes, falha de pesquisa ou falta de chave resulta numa
declaração explícita de que não foi possível confirmar. Datas antigas na base
local continuam identificadas como registos, nunca como confirmação atual.

## Arquitetura principal da IA

O pipeline de resposta é separado por responsabilidade em `src/ai/`:

| Módulo | Responsabilidade |
| --- | --- |
| `personality.mjs` | Personalidade Nur e adaptação de tom ao assunto. |
| `intent.mjs` | Classifica saudações, estudos, negócios, comunicação, conteúdo e perguntas locais ou atuais. |
| `education.mjs` | Deteta disciplina, tipo de apoio e nível explicitamente referido; prepara instruções pedagógicas sem criar fontes. |
| `business.mjs` | Orienta ideias e planeamento de negócios com separação explícita entre dados reais, estimativas e sugestões; não inventa preços atuais nem factos locais. |
| `tourism-life.mjs` | Orienta perguntas de turismo e vida local, resolve o âmbito geográfico sem misturar destinos e exige fontes atuais para informação dinâmica. |
| `local-intent.mjs` | Usa Gemini para estruturar intenção, categoria e filtros locais; valida a saída antes de consultar o JSON e não recebe nem cria resultados. |
| `conversation-memory.mjs` | Seleciona trechos relevantes do histórico e da memória voluntária do perfil para o contexto do modelo. |
| `general-knowledge.mjs` | Respostas de contingência quando o modelo não está configurado. |
| `maxixe-knowledge.mjs` | Carrega e indexa o JSON oficial e os factos suplementares; pesquisa registos locais, factos, bairros, estados e confiabilidade. |
| `local-response.mjs` | Compõe respostas locais exclusivamente a partir dos registos e factos selecionados da base. |
| `current-information.mjs` | Pede verificação atual via Google Search Grounding Gemini e mantém as fontes citadas pela API. |
| `reliability.mjs` | Distingue dados locais de fontes recentes e sinaliza o que precisa de confirmação. |
| `safety.mjs` | Aplica limites de segurança e privacidade apropriados também a menores. |
| `model-client.mjs` | Isola as chamadas ao endpoint Gemini compatível com OpenAI e ao `generateContent` com Google Search Grounding. |
| `generate-reply.mjs` | Coordena as camadas e compõe a resposta final. |
| `index.mjs` | Ponto de entrada público do agente. |

As regras e dados locais são separados da orquestração para permitir acrescentar
novas fontes sem reescrever o servidor. O histórico usado como memória fica
limitado à conversa selecionada e às mensagens recentes guardadas pelo sistema
de mensagens; nome, email e outras conversas não são incluídos no contexto do
modelo.

Nas perguntas escolares, o módulo `education.mjs` orienta a Gemini a explicar
passo a passo, adaptar a profundidade ao nível explicitamente fornecido ou
começar de forma acessível, dar exemplos e exercícios quando forem úteis,
verificar respostas e apoiar trabalhos e projetos. O contexto de Moçambique é
usado apenas quando esclarece o tema. A instrução proíbe inventar fontes,
citações, bibliografia e requisitos curriculares; se referências forem
necessárias mas não estiverem disponíveis, o Nur deve pedir fontes verificáveis.

Nas perguntas de negócios e empreendedorismo, `business.mjs` orienta a Gemini
para apoiar ideias, planos, clientes, produtos, custos, marketing, marcas,
anúncios, vendas e concorrência. Quando a pergunta envolve Maxixe, os factos e
registos recuperados da Base Oficial são enviados como contexto factual, sem
substituir os valores ausentes. A resposta separa, quando aplicável, **DADO
REAL**, **ESTIMATIVA** (com premissas e cálculo identificados) e **SUGESTÃO**.
Preços e custos atuais só podem ser apresentados com fonte recente verificável;
sem ela, o Bot Nur informa que precisam de confirmação e pode fornecer uma
estrutura de cálculo sem inventar valores.

Nas perguntas de turismo e vida local, `tourism-life.mjs` identifica o destino
pedido e mantém separadas Maxixe, Cidade de Inhambane, província de Inhambane,
Tofo, Barra, Vilankulo e outras localidades. Sem destino explícito, aplica a
prioridade de Maxixe; «Inhambane» sem especificar cidade ou província e pedidos
que misturam destinos recebem uma pergunta de esclarecimento. A pesquisa da
Base Oficial é usada apenas para Maxixe. Para outros destinos, a pesquisa web
opcional deve fornecer evidência associada ao local; eventos, horários, preços
e disponibilidade exigem fontes recentes verificáveis. Sem dados adequados, o
Nur declara a limitação em vez de completar a resposta com opções inventadas.

## Perfil e memória contextual

As contas podem guardar voluntariamente interesses, objetivos, preferências,
assuntos favoritos e projetos em andamento em `user_memory` no SQLite local.
O perfil permite editar o nome; nas definições podes consultar, substituir ou
apagar a memória, desativar o seu uso pela IA e apagar todo o histórico.
Visitantes podem conversar e apagar o próprio histórico, mas precisam de uma
conta para persistir memória entre conversas. A memória não é inferida a partir
do histórico: só os itens submetidos pelo utilizador são guardados.

Antes de chamar o modelo, o Bot Nur seleciona no máximo quatro trechos de
memória que partilham termos com a pergunta. Do histórico da conversa são
selecionadas até quatro mensagens recentes e, quando houver correspondência,
mensagens anteriores relevantes, com um máximo de oito. Nenhuma outra conversa
é consultada. A opção de memória pode ser desligada sem apagar os itens; apagar
a memória remove-os permanentemente. A API rejeita conteúdo que pareça conter
palavras-passe, chaves, dados financeiros, de saúde ou outros dados sensíveis.

## Tempo de resposta

Sem uma chave `GEMINI_API_KEY` ou `AI_API_KEY` válida, as respostas locais não dependem da rede e
são normalmente imediatas. Nesse modo, o Nur utiliza informação local e
respostas predefinidas para alguns temas; **não é um modelo de IA generativa**.
Com Gemini configurado, o tempo de resposta depende do serviço e da ligação à
Internet. Perguntas sobre informação recente também podem demorar mais quando
a pesquisa web está ativada. Se uma resposta do modelo demorar mais de 30
segundos, o pedido é cancelado e a aplicação apresenta uma mensagem de erro.

## Verificações

```powershell
npm.cmd test
```

A suíte de testes valida o pipeline modular da IA, a aplicação HTTP, o modo
visitante, respostas e persistência, autenticação, isolamento entre utilizadores
e gestão do histórico, sem consumir a quota de serviços externos.
