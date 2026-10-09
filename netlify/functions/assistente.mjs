// Configurações copiadas de app/configuracao.js
const SUPABASE_URL = "https://bileekjhcyiwtxouzpjm.supabase.co";
const SUPABASE_CHAVE_PUBLICA = "sb_publishable_1GEYFGmweebeHOIDB4MJ2g_Dz5HUaWd";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Ferramentas do assistente para o Gemini
const FERRAMENTAS = [
  {
    function_declarations: [
      {
        name: "registrar_gasto",
        description:
          "Registra um gasto financeiro no banco de dados do usuário. Use quando o usuário informar um gasto, seja por texto ou pela foto de um cupom fiscal.",
        parameters: {
          type: "OBJECT",
          properties: {
            data: {
              type: "STRING",
              description: "Data do gasto no formato AAAA-MM-DD",
            },
            descricao: {
              type: "STRING",
              description:
                "Descrição curta do gasto (nome do estabelecimento ou o que comprou)",
            },
            valor: {
              type: "NUMBER",
              description: "Valor total do gasto em reais",
            },
            categoria: {
              type: "STRING",
              description: "Categoria do gasto, escolhida entre as categorias disponíveis",
            },
          },
          required: ["data", "descricao", "valor", "categoria"],
        },
      },
      {
        name: "consultar_gastos",
        description:
          "Consulta os gastos do usuário em um período, opcionalmente filtrado por categoria. Use para responder perguntas sobre totais, resumos ou listas de gastos.",
        parameters: {
          type: "OBJECT",
          properties: {
            desde: {
              type: "STRING",
              description: "Data de início do período no formato AAAA-MM-DD",
            },
            ate: {
              type: "STRING",
              description: "Data de fim do período no formato AAAA-MM-DD",
            },
            categoria: {
              type: "STRING",
              description:
                "Categoria para filtrar (opcional). Se não informada, retorna todas.",
            },
          },
          required: ["desde", "ate"],
        },
      },
    ],
  },
];

// Respostas utilitárias
function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function erroResposta(status, mensagem) {
  return resposta(status, { erro: mensagem });
}

// Data de hoje em São Paulo
function hojeEmSaoPaulo() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

// Verifica o login da pessoa usando o token
async function verificarUsuario(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_CHAVE_PUBLICA,
    },
  });
  if (!res.ok) return null;
  return await res.json();
}

// Grava gasto via REST do Supabase usando o token da pessoa (RLS ativo)
async function gravarGasto(token, gasto) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gastos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_CHAVE_PUBLICA,
      Prefer: "return=representation",
    },
    body: JSON.stringify(gasto),
  });
  if (!res.ok) {
    const erro = await res.text();
    throw new Error(erro);
  }
  return await res.json();
}

// Consulta gastos via REST do Supabase usando o token da pessoa (RLS ativo)
async function consultarGastos(token, desde, ate, categoria) {
  let url = `${SUPABASE_URL}/rest/v1/gastos?select=*&data=gte.${desde}&data=lte.${ate}&order=data.desc`;
  if (categoria) {
    url += `&categoria=eq.${encodeURIComponent(categoria)}`;
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_CHAVE_PUBLICA,
    },
  });
  if (!res.ok) {
    const erro = await res.text();
    throw new Error(erro);
  }
  return await res.json();
}

// Chama a API do Gemini
async function chamarGemini(chave, mensagens, ferramentas) {
  const corpo = {
    contents: mensagens,
    tools: ferramentas,
  };

  const res = await fetch(`${GEMINI_URL}?key=${chave}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  if (!res.ok) {
    const texto = await res.text();
    if (res.status === 429) {
      throw new Error("LIMITE_ATINGIDO");
    }
    if (res.status === 400 && texto.includes("API_KEY")) {
      throw new Error("CHAVE_INVALIDA");
    }
    throw new Error(`Erro na API Gemini (${res.status}): ${texto}`);
  }

  return await res.json();
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Handler principal
export default async (req) => {
  // Apenas POST
  if (req.method !== "POST") {
    return erroResposta(405, "Use o método POST para falar com o assistente.");
  }

  // Verifica chave do Gemini no servidor
  const chaveGemini = process.env.CHAVE_GEMINI;
  if (!chaveGemini) {
    return erroResposta(500, "O assistente não está configurado. Avise o administrador para adicionar a chave do Gemini no servidor.");
  }

  // Verifica token de autenticação
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return erroResposta(401, "Você precisa estar logado para usar o assistente. Faça login novamente.");
  }

  // Valida usuário
  let usuario;
  try {
    usuario = await verificarUsuario(token);
  } catch {
    return erroResposta(401, "Não foi possível verificar seu login. Verifique sua conexão e tente novamente.");
  }
  if (!usuario || !usuario.id) {
    return erroResposta(401, "Sua sessão expirou. Faça login novamente para continuar.");
  }

  // Lê o corpo da requisição
  let corpo;
  try {
    corpo = await req.json();
  } catch {
    return erroResposta(400, "Mensagem inválida. Tente novamente.");
  }

  const { mensagem, imagem, mime, categorias } = corpo;

  if (!mensagem && !imagem) {
    return erroResposta(400, "Escreva um gasto, uma pergunta, ou envie a foto de um cupom.");
  }

  const categoriasTexto = (categorias || []).join(", ");
  const hoje = hojeEmSaoPaulo();

  // Monta o prompt do sistema
  const promptSistema = `Você é o assistente financeiro do app MEU BOLSO-NARO. Hoje em São Paulo é ${hoje}.

As categorias de gasto disponíveis são: ${categoriasTexto}.

Regras:
- Quando o usuário informar um gasto (por texto ou foto), use a ferramenta registrar_gasto.
- Quando o usuário perguntar sobre gastos (totais, resumos, listas), use a ferramenta consultar_gastos.
- Se não tiver informação suficiente (ex: valor faltando), pergunte ao usuário.
- Quando vier uma FOTO DE CUPOM FISCAL: extraia o VALOR TOTAL do cupom (não valores individuais), a DATA DE EMISSÃO e o NOME DA LOJA/ESTABELECIMENTO para a descrição. Escolha a categoria mais adequada.
- Sempre use as categorias disponíveis. Se não souber qual, use OUTROS.
- Datas devem estar no formato AAAA-MM-DD. Se o usuário disser "hoje", use ${hoje}. Se disser "ontem", calcule a data correta.
- Responda sempre em português do Brasil, de forma curta e direta.`;

  // Monta as partes da mensagem do usuário
  const partesUsuario = [];
  if (mensagem) {
    partesUsuario.push({ text: mensagem });
  }
  if (imagem) {
    partesUsuario.push({
      inline_data: {
        mime_type: mime || "image/jpeg",
        data: imagem,
      },
    });
    if (!mensagem) {
      partesUsuario.push({ text: "Extraia os dados deste cupom fiscal e registre o gasto." });
    }
  }

  const mensagensGemini = [
    { role: "user", parts: [{ text: promptSistema }] },
    { role: "model", parts: [{ text: "Entendido. Estou pronto para ajudar com seus gastos." }] },
    { role: "user", parts: partesUsuario },
  ];

  // Chama o Gemini
  let respostaGemini;
  try {
    respostaGemini = await chamarGemini(chaveGemini, mensagensGemini, FERRAMENTAS);
  } catch (err) {
    const msg = err.message || "";
    if (msg === "LIMITE_ATINGIDO") {
      return erroResposta(429, "O assistente atingiu o limite de uso temporariamente. Aguarde alguns minutos e tente novamente.");
    }
    if (msg === "CHAVE_INVALIDA") {
      return erroResposta(500, "A chave do assistente é inválida. Avise o administrador para corrigir a chave do Gemini.");
    }
    return erroResposta(502, `Erro ao consultar o assistente: ${msg}`);
  }

  // Processa a resposta do Gemini
  const candidato = respostaGemini?.candidates?.[0];
  const partes = candidato?.content?.parts || [];

  // Verifica se o modelo pediu uma chamada de ferramenta
  const chamadaFerramenta = partes.find((p) => p.functionCall);

  if (!chamadaFerramenta) {
    // Sem chamada de ferramenta: devolve o texto do modelo
    const textoResposta = partes.map((p) => p.text || "").join("").trim();
    return resposta(200, {
      resposta: textoResposta || "Não entendi. Pode reformular?",
      acao: null,
    });
  }

  const { name: nomeFuncao, args } = chamadaFerramenta.functionCall;

  // registrar_gasto
  if (nomeFuncao === "registrar_gasto") {
    const { data, descricao, valor, categoria } = args;

    if (!valor || !descricao) {
      return resposta(200, {
        resposta: "Não consegui identificar todos os dados do gasto. Pode informar o valor e a descrição?",
        acao: null,
      });
    }

    try {
      const origem = imagem ? "foto" : "texto";
      await gravarGasto(token, {
        dono: usuario.id,
        data: data || hoje,
        descricao,
        valor: Number(valor),
        categoria: categoria || "OUTROS",
        origem,
      });

      const dataFormatada = (data || hoje).split("-").reverse().join("/");
      return resposta(200, {
        resposta: `Lancei ${formatarMoeda(valor)} em ${categoria || "OUTROS"}: ${descricao}, ${dataFormatada}.`,
        acao: "gasto_registrado",
      });
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("gastos")) {
        return erroResposta(500, "Erro ao acessar a tabela de gastos. Verifique se a tabela existe no banco de dados.");
      }
      return erroResposta(500, `Erro ao salvar o gasto: ${msg}`);
    }
  }

  // consultar_gastos
  if (nomeFuncao === "consultar_gastos") {
    const { desde, ate, categoria } = args;

    try {
      const gastos = await consultarGastos(token, desde, ate, categoria);
      const total = gastos.reduce((acc, g) => acc + Number(g.valor || 0), 0);
      const qtd = gastos.length;

      let textoCategoria = categoria ? ` em ${categoria}` : "";
      let textoResposta;

      if (qtd === 0) {
        textoResposta = `Nenhum gasto encontrado${textoCategoria} nesse período.`;
      } else {
        textoResposta = `Você tem ${qtd} gasto${qtd > 1 ? "s" : ""}${textoCategoria} nesse período, totalizando ${formatarMoeda(total)}.`;
      }

      return resposta(200, {
        resposta: textoResposta,
        acao: "consulta",
        dados: { total, quantidade: qtd },
      });
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("gastos")) {
        return erroResposta(500, "Erro ao acessar a tabela de gastos. Verifique se a tabela existe no banco de dados.");
      }
      return erroResposta(500, `Erro ao consultar seus gastos: ${msg}`);
    }
  }

  // Ferramenta desconhecida
  return resposta(200, {
    resposta: "Não entendi o que fazer. Pode reformular?",
    acao: null,
  });
};

export const config = { path: "/api/assistente" };
