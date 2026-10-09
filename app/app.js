// Inicialização segura do cliente Supabase a partir das configurações
(function () {
  const config = window.MEU_BOLSO || {};
  const rawUrl = (config.SUPABASE_URL || "").replace(/^[\[\(]/, "").replace(/[\]\)]$/, "").trim();
  const rawKey = (config.SUPABASE_CHAVE_PUBLICA || "").replace(/^[\[\(]/, "").replace(/[\]\)]$/, "").trim();
  
  // Remove eventual sufixo /rest/v1 do endpoint para que o cliente configure auth e rest corretamente
  const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  
  if (!window.supabase || !cleanUrl || !rawKey) {
    console.error("Configurações do Supabase ausentes ou incompletas.");
    return;
  }

  const supabase = window.supabase.createClient(cleanUrl, rawKey);

  // Elementos da Interface
  const telaAuth = document.getElementById("telaAuth");
  const telaPrincipal = document.getElementById("telaPrincipal");
  const mensagemFeedback = document.getElementById("mensagemFeedback");

  // Autenticação
  const authEmail = document.getElementById("authEmail");
  const authSenha = document.getElementById("authSenha");
  const btnEntrar = document.getElementById("btnEntrar");
  const btnCriarConta = document.getElementById("btnCriarConta");
  const btnSair = document.getElementById("btnSair");

  // Dashboard
  const totalMesEl = document.getElementById("totalMes");
  const listaBarrasEl = document.getElementById("listaBarras");
  const listaGastosEl = document.getElementById("listaGastos");

  // Resumo da Semana
  const cardResumo = document.getElementById("cardResumo");
  const textoResumo = document.getElementById("textoResumo");

  // Formulário de Gastos
  const formLancarGasto = document.getElementById("formLancarGasto");
  const gastoValor = document.getElementById("gastoValor");
  const gastoDescricao = document.getElementById("gastoDescricao");
  const gastoCategoria = document.getElementById("gastoCategoria");
  const gastoData = document.getElementById("gastoData");

  // Assistente
  const assistenteTexto = document.getElementById("assistenteTexto");
  const btnAssistenteEnviar = document.getElementById("btnAssistenteEnviar");
  const inputFotoCupom = document.getElementById("inputFotoCupom");
  const assistenteMensagem = document.getElementById("assistenteMensagem");

  let usuarioAtual = null;

  // Tradutor amigável de erros para frases em português com instrução de ação
  function traduzirErro(erro) {
    if (!erro) return "Ocorreu um erro inesperado. Tente novamente.";
    const msg = erro.message || String(erro);

    if (msg.includes("Forbidden use of secret API key in browser") || msg.includes("secret API key")) {
      return "Chave secreta detectada no navegador. No Supabase, copie a chave pública (anon) em Project Settings > API e cole em app/configuracao.js.";
    }
    if (msg.includes("Invalid login credentials")) {
      return "E-mail ou senha incorretos. Verifique suas credenciais e tente novamente.";
    }
    if (msg.includes("User already registered")) {
      return "Este e-mail já está cadastrado. Clique no botão Entrar ou use outro e-mail.";
    }
    if (msg.includes("Password should be at least 6 characters")) {
      return "A senha deve conter no mínimo 6 caracteres. Digite uma senha mais longa.";
    }
    if (msg.includes("invalid format") || msg.includes("validate email")) {
      return "Formato de e-mail inválido. Por favor, digite um e-mail válido.";
    }
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return "Falha de conexão com a rede. Verifique sua conexão com a internet e tente novamente.";
    }
    if (msg.includes("Email not confirmed")) {
      return "E-mail ainda não confirmado. Verifique a sua caixa de entrada para prosseguir.";
    }
    if (msg.includes("JWT")) {
      return "Sua sessão expirou. Faça login novamente para continuar.";
    }
    return `Não foi possível completar a ação (${msg}). Tente novamente em instantes.`;
  }

  function exibirMensagem(texto, tipo = "erro", tempoMs = 5000) {
    mensagemFeedback.textContent = texto;
    mensagemFeedback.className = `mensagem ${tipo}`;
    mensagemFeedback.classList.remove("oculto");

    if (tempoMs > 0) {
      setTimeout(() => {
        mensagemFeedback.classList.add("oculto");
      }, tempoMs);
    }
  }

  function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });
  }

  function formatarDataBR(dataStr) {
    if (!dataStr) return "";
    const partes = dataStr.split("-");
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return dataStr;
  }

  // Preenche opções de categoria a partir do config
  function inicializarCategorias() {
    const categorias = config.CATEGORIAS || [
      "MERCADO",
      "FARMÁCIA",
      "TRANSPORTE",
      "RESTAURANTE",
      "CASA",
      "LAZER",
      "OUTROS"
    ];
    gastoCategoria.innerHTML = "";
    categorias.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      gastoCategoria.appendChild(opt);
    });
  }

  // Define data padrão de hoje
  function definirDataPadrao() {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const dia = String(hoje.getDate()).padStart(2, "0");
    gastoData.value = `${ano}-${mes}-${dia}`;
  }

  // Intervalo do mês atual (ano-mes-01 até o último dia do mês)
  function obterIntervaloMesAtual() {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth();
    const primeiroDia = new Date(ano, mes, 1);
    const ultimoDia = new Date(ano, mes + 1, 0);

    const inicio = primeiroDia.toISOString().split("T")[0];
    const fim = ultimoDia.toISOString().split("T")[0];
    return { inicio, fim };
  }

  // Alterna entre tela de login e tela principal
  function alternarTelas(logado) {
    if (logado) {
      telaAuth.classList.add("oculto");
      telaPrincipal.classList.remove("oculto");
    } else {
      telaPrincipal.classList.add("oculto");
      telaAuth.classList.remove("oculto");
    }
  }

  // Carrega resumo da semana
  async function carregarResumoSemana() {
    try {
      const { data, error } = await supabase
        .from("resumos")
        .select("texto, criado_em")
        .order("criado_em", { ascending: false })
        .limit(1);

      if (error) {
        console.warn("Aviso ao carregar resumos:", error);
        cardResumo.classList.add("oculto");
        return;
      }

      if (data && data.length > 0 && data[0].texto && data[0].texto.trim() !== "") {
        textoResumo.textContent = data[0].texto;
        cardResumo.classList.remove("oculto");
      } else {
        cardResumo.classList.add("oculto");
      }
    } catch (e) {
      cardResumo.classList.add("oculto");
    }
  }

  // Renderiza as barras por categoria
  function renderizarBarras(gastos, totalGeral) {
    listaBarrasEl.innerHTML = "";

    const categoriasConfig = config.CATEGORIAS || [];
    const totaisPorCat = {};

    // Agrupa gastos por categoria
    gastos.forEach((g) => {
      const cat = g.categoria || "OUTROS";
      totaisPorCat[cat] = (totaisPorCat[cat] || 0) + Number(g.valor || 0);
    });

    // Mostra as categorias que possuem gastos ou todas as configuradas
    const categoriasParaExibir = categoriasConfig.filter(
      (cat) => (totaisPorCat[cat] || 0) > 0
    );

    if (categoriasParaExibir.length === 0) {
      listaBarrasEl.innerHTML = `<p class="gasto-vazio">Sem gastos por categoria neste mês.</p>`;
      return;
    }

    // Ordena da maior para a menor
    categoriasParaExibir.sort((a, b) => (totaisPorCat[b] || 0) - (totaisPorCat[a] || 0));

    categoriasParaExibir.forEach((cat) => {
      const valor = totaisPorCat[cat] || 0;
      const porcentagem = totalGeral > 0 ? ((valor / totalGeral) * 100).toFixed(1) : 0;

      const item = document.createElement("div");
      item.className = "barra-item";
      item.innerHTML = `
        <div class="barra-item-header">
          <span class="barra-item-nome">${cat}</span>
          <span class="barra-item-valor">${formatarMoeda(valor)} (${porcentagem}%)</span>
        </div>
        <div class="barra-trilho">
          <div class="barra-progresso" style="width: ${porcentagem}%;"></div>
        </div>
      `;
      listaBarrasEl.appendChild(item);
    });
  }

  // Renderiza a lista de gastos do mês
  function renderizarListaGastos(gastos) {
    listaGastosEl.innerHTML = "";

    if (!gastos || gastos.length === 0) {
      listaGastosEl.innerHTML = `<p class="gasto-vazio">Nenhum gasto registrado neste mês.</p>`;
      return;
    }

    gastos.forEach((gasto) => {
      const item = document.createElement("div");
      item.className = "gasto-item";
      item.innerHTML = `
        <div class="gasto-info">
          <span class="gasto-descricao">${gasto.descricao || "Sem descrição"}</span>
          <div class="gasto-meta">
            <span class="gasto-categoria-badge">${gasto.categoria || "OUTROS"}</span>
            <span>${formatarDataBR(gasto.data)}</span>
          </div>
        </div>
        <div class="gasto-valor-acao">
          <span class="gasto-valor">${formatarMoeda(gasto.valor)}</span>
          <button class="btn-apagar" data-id="${gasto.id}">Apagar</button>
        </div>
      `;

      const btnApagar = item.querySelector(".btn-apagar");
      btnApagar.addEventListener("click", () => apagarGasto(gasto.id));

      listaGastosEl.appendChild(item);
    });
  }

  // Apagar gasto individual
  async function apagarGasto(id) {
    if (!confirm("Deseja realmente apagar este gasto?")) return;

    try {
      const { error } = await supabase.from("gastos").delete().eq("id", id);
      if (error) {
        exibirMensagem(traduzirErro(error), "erro");
        return;
      }
      exibirMensagem("Gasto apagado com sucesso.", "sucesso", 3000);
      carregarDadosDoMes();
    } catch (err) {
      exibirMensagem(traduzirErro(err), "erro");
    }
  }

  // Carrega e atualiza todos os dados do mês
  async function carregarDadosDoMes() {
    if (!usuarioAtual) return;

    const { inicio, fim } = obterIntervaloMesAtual();

    try {
      const { data: gastos, error } = await supabase
        .from("gastos")
        .select("*")
        .gte("data", inicio)
        .lte("data", fim)
        .order("data", { ascending: false })
        .order("criado_em", { ascending: false });

      if (error) {
        exibirMensagem(traduzirErro(error), "erro");
        return;
      }

      const lista = gastos || [];
      const totalMes = lista.reduce((acc, curr) => acc + Number(curr.valor || 0), 0);

      // Atualiza o total no topo (visível nos primeiros 5 segundos)
      totalMesEl.textContent = formatarMoeda(totalMes);

      // Atualiza as barras de categoria e a lista
      renderizarBarras(lista, totalMes);
      renderizarListaGastos(lista);

      // Carrega o resumo da semana
      carregarResumoSemana();
    } catch (err) {
      exibirMensagem(traduzirErro(err), "erro");
    }
  }

  // Salvar gasto manual
  formLancarGasto.addEventListener("submit", async (e) => {
    e.preventDefault();

    const valor = parseFloat(gastoValor.value);
    const descricao = gastoDescricao.value.trim();
    const categoria = gastoCategoria.value;
    const data = gastoData.value;

    if (!valor || valor <= 0) {
      exibirMensagem("Informe um valor maior que zero para lançar o gasto.", "erro");
      return;
    }
    if (!descricao) {
      exibirMensagem("Informe a descrição de onde ou com o que gastou.", "erro");
      return;
    }
    if (!categoria) {
      exibirMensagem("Selecione uma categoria válida.", "erro");
      return;
    }
    if (!data) {
      exibirMensagem("Informe a data do gasto.", "erro");
      return;
    }

    try {
      const novoGasto = {
        dono: usuarioAtual.id,
        data: data,
        descricao: descricao,
        valor: valor,
        categoria: categoria,
        origem: "manual"
      };

      const { error } = await supabase.from("gastos").insert([novoGasto]);

      if (error) {
        exibirMensagem(traduzirErro(error), "erro");
        return;
      }

      exibirMensagem("Gasto lançado com sucesso!", "sucesso", 3000);
      gastoValor.value = "";
      gastoDescricao.value = "";
      definirDataPadrao();
      carregarDadosDoMes();
    } catch (err) {
      exibirMensagem(traduzirErro(err), "erro");
    }
  });

  // Autenticação: Entrar (signInWithPassword)
  btnEntrar.addEventListener("click", async () => {
    const email = authEmail.value.trim();
    const password = authSenha.value;

    if (!email || !password) {
      exibirMensagem("Preencha o e-mail e a senha para entrar.", "erro");
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        exibirMensagem(traduzirErro(error), "erro");
        return;
      }

      if (data && data.user) {
        usuarioAtual = data.user;
        authSenha.value = "";
        alternarTelas(true);
        carregarDadosDoMes();
      }
    } catch (err) {
      exibirMensagem(traduzirErro(err), "erro");
    }
  });

  // Autenticação: Criar conta (signUp)
  btnCriarConta.addEventListener("click", async () => {
    const email = authEmail.value.trim();
    const password = authSenha.value;

    if (!email || !password) {
      exibirMensagem("Preencha o e-mail e a senha para criar uma conta.", "erro");
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      });

      if (error) {
        exibirMensagem(traduzirErro(error), "erro");
        return;
      }

      if (data && data.session && data.user) {
        usuarioAtual = data.user;
        authSenha.value = "";
        exibirMensagem("Conta criada com sucesso!", "sucesso", 3000);
        alternarTelas(true);
        carregarDadosDoMes();
      } else if (data && data.user) {
        // Tenta login direto caso a confirmação de e-mail esteja desabilitada
        const loginTentativa = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (loginTentativa.data && loginTentativa.data.user) {
          usuarioAtual = loginTentativa.data.user;
          authSenha.value = "";
          alternarTelas(true);
          carregarDadosDoMes();
        } else {
          exibirMensagem("Conta criada com sucesso! Você já pode entrar.", "sucesso", 4000);
        }
      }
    } catch (err) {
      exibirMensagem(traduzirErro(err), "erro");
    }
  });

  // Botão Sair
  btnSair.addEventListener("click", async () => {
    await supabase.auth.signOut();
    usuarioAtual = null;
    alternarTelas(false);
  });

  // Assistente: Enviar texto e Foto do cupom
  function acionarAssistente() {
    assistenteMensagem.textContent = "o assistente chega no próximo exercício.";
    assistenteMensagem.classList.remove("oculto");
    assistenteTexto.value = "";
  }

  btnAssistenteEnviar.addEventListener("click", acionarAssistente);

  // Regra fundamental do briefing: O app NUNCA guarda a foto do cupom.
  // A foto não é enviada para o banco nem armazenada; o input é imediatamente limpo.
  inputFotoCupom.addEventListener("change", () => {
    inputFotoCupom.value = "";
    acionarAssistente();
  });

  // Inicialização do app
  async function inicializar() {
    inicializarCategorias();
    definirDataPadrao();

    // Verifica sessão existente
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) {
      usuarioAtual = session.user;
      alternarTelas(true);
      carregarDadosDoMes();
    } else {
      alternarTelas(false);
    }

    // Monitora alterações no estado de autenticação
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        usuarioAtual = session.user;
        alternarTelas(true);
        carregarDadosDoMes();
      } else {
        usuarioAtual = null;
        alternarTelas(false);
      }
    });
  }

  inicializar();
})();
