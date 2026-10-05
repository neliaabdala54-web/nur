export function getLocalGeneralAnswer(text, intent, localFacts = []) {
  if (intent.isGreeting) {
    return "Olá! 👋 Sou o Nur, o teu assistente. Posso ajudar com estudos, ideias, escrita ou informações sobre Moçambique e Maxixe. O que gostarias de fazer hoje?";
  }

  if (intent.isLocalQuestion) {
    const location = localFacts.find((fact) => fact.topic === "Localização")?.text
      ?? "Maxixe é uma cidade da província de Inhambane, em Moçambique.";
    return `${location}\n\nHorários, contactos e disponibilidade dos estabelecimentos podem mudar. Se procuras um serviço ou lugar específico, diz-me qual — e confirma os detalhes atuais antes de viajar.`;
  }

  if (intent.category === "education") {
    return "Vamos trabalhar nisso, passo a passo. Um bom ponto de partida para um trabalho escolar é:\n\n1. **Introdução:** apresenta o tema e o objetivo.\n2. **Desenvolvimento:** organiza as ideias em 2–3 secções e explica cada uma com exemplos.\n3. **Conclusão:** resume o que aprendeste.\n4. **Fontes:** identifica os livros ou materiais consultados.\n\nConta-me a disciplina, o tema e a tua classe para te ajudar a criar uma resposta adequada.";
  }

  if (intent.category === "business") {
    return "Uma ideia simples de negócio começa com uma necessidade real. Podes experimentar este plano:\n\n1. Observa o que falta ou dá trabalho às pessoas à tua volta.\n2. Fala com cinco potenciais clientes antes de gastar dinheiro.\n3. Faz um teste pequeno, usando recursos que já tens.\n4. Regista custos, vendas e o que podes melhorar.\n\nQue recursos tens disponíveis e que tipo de negócio te interessa?";
  }

  if (intent.category === "content") {
    return "Claro! Posso ajudar-te a criar ideias, legendas e publicações para as redes sociais. Para personalizar a sugestão, diz-me qual é o tema, a plataforma e o estilo que procuras — por exemplo, divertido, informativo ou profissional.";
  }

  if (intent.category === "relationships") {
    return "Posso ajudar-te a encontrar as palavras certas. Conta-me, sem partilhar dados pessoais, o que gostarias de dizer, a quem e com que tom — por exemplo, amigável, claro ou conciliador.";
  }

  if (/\b(projeto|ideia|ideias|criar|começar|comecar)\b/i.test(text)) {
    return "Posso ajudar-te a transformar essa ideia num plano simples. Diz-me qual é o objetivo, para quem é e que recursos tens disponíveis.";
  }

  return "Posso ajudar-te com estudos, projetos, ideias de negócio, escrita, comunicação e informação sobre Moçambique. Diz-me um pouco mais sobre o que precisas e trato disso contigo.";
}
