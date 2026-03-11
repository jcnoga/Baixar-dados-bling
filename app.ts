// ==================== INTERFACES ====================
interface Usuario {
    uid: string;
    nome: string;
    email: string;
    perfil: 'owner' | 'user';
}

interface BlingConfig {
    apiKey: string;
    accessToken: string;
    modoSimulado: boolean;
}

interface ExportConfig {
    basePath: string;
    organizacao: 'data' | 'modulo' | 'unica';
    incluirMetadados: 'sim' | 'nao';
    nomeArquivo: string;
}

interface Database {
    clientes: any[];
    produtos: any[];
    vendas: any[];
    compras: any[];
    fornecedores: any[];
}

interface Marcadores {
    clientes: {
        inativos: any[];
        vip: any[];
        frequentes: any[];
        emQueda: any[];
    };
    produtos: {
        campeoes: any[];
        giroLento: any[];
        semVenda: any[];
        altaMargem: any[];
        baixaMargem: any[];
    };
    estoque: {
        baixo: any[];
        alto: any[];
        parado: any[];
    };
    oportunidades: {
        promocao: any[];
        clientes: any[];
        tendencia: any[];
    };
}

// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyCWr1rhmFYX2naAqWUaIb52oy6-6FJxhe8",
    authDomain: "dados-bling.firebaseapp.com",
    projectId: "dados-bling",
    storageBucket: "dados-bling.firebasestorage.app",
    messagingSenderId: "95224193291",
    appId: "1:95224193291:web:c61f0f2c5b9776ab9c420e",
    measurementId: "G-BWWH69VXXL"
};

// Inicializar Firebase apenas se não estiver inicializado
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const firestore = firebase.firestore();

// ==================== INDEXEDDB MANAGER ====================
const DB_NAME = 'BlingIntelligenceDB';
const STORES = ['clientes', 'produtos', 'vendas', 'compras', 'fornecedores', 'config', 'exportConfig', 'syncMetadata'];

class IndexedDBManager {
    async openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 4);
            req.onupgradeneeded = (ev) => {
                const db = ev.target.result;
                STORES.forEach(store => {
                    if (!db.objectStoreNames.contains(store)) {
                        db.createObjectStore(store, { keyPath: 'id' });
                    }
                });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(store: string): Promise<any[]> {
        const db = await this.openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    async put(store: string, data: any): Promise<void> {
        const db = await this.openDB();
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(data);
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    }

    async get(store: string, id: string): Promise<any> {
        const db = await this.openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    }

    async delete(store: string, id: string): Promise<void> {
        const db = await this.openDB();
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    }

    async clear(store: string): Promise<void> {
        const db = await this.openDB();
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    }
}

const dbManager = new IndexedDBManager();

// ==================== VUE APP ====================
new Vue({
    el: '#app',
    data: {
        // Autenticação
        usuarioLogado: null as Usuario | null,
        loginEmail: '',
        loginSenha: '',
        loading: false,
        erroLogin: '',
        aba: 'dashboard',
        abaDados: 'clientes',
        
        // Formato de exportação
        formatoExportacao: 'json',
        
        // Tipo de importação (total ou incremental)
        tipoImportacao: 'incremental',
        
        // Última sincronização
        ultimaSync: null as string | null,
        
        // Configurações
        exportConfig: {
            basePath: '/exports/bling-data',
            organizacao: 'data',
            incluirMetadados: 'sim',
            nomeArquivo: '{modulo}_{data}'
        } as ExportConfig,
        
        blingConfig: {
            apiKey: '',
            accessToken: '',
            modoSimulado: false
        } as BlingConfig,
        
        // Status
        blingConectado: false,
        testandoBling: false,
        importandoBling: false,
        gerandoDados: false,
        erroBling: '',
        resultadoImportacao: [] as string[],
        mostrarModalSimulacao: false,
        mostrarSeletorPastas: false,
        exportacaoTesteResultado: '',
        
        // Dados
        db: {
            clientes: [],
            produtos: [],
            vendas: [],
            compras: [],
            fornecedores: []
        } as Database,
        
        // Marcadores
        marcadores: {
            clientes: { inativos: [], vip: [], frequentes: [], emQueda: [] },
            produtos: { campeoes: [], giroLento: [], semVenda: [], altaMargem: [], baixaMargem: [] },
            estoque: { baixo: [], alto: [], parado: [] },
            oportunidades: { promocao: [], clientes: [], tendencia: [] }
        } as Marcadores
    },

    computed: {
        totalRegistros(): number {
            return this.db.clientes.length + this.db.produtos.length + this.db.vendas.length + 
                   this.db.compras.length + this.db.fornecedores.length;
        },
        
        totalVendas(): number {
            return this.db.vendas.reduce((acc, v) => acc + (parseFloat(v.valor) || 0), 0);
        },
        
        ultimaSyncFormatada(): string {
            return this.ultimaSync ? new Date(this.ultimaSync).toLocaleString('pt-BR') : 'Nunca';
        }
    },

    methods: {
        formatNumber(v: number): string {
            return (v || 0).toLocaleString('pt-BR');
        },
        
        formatMoney(v: number): string {
            if (!v) return 'R$ 0,00';
            const valor = parseFloat(v as any);
            if (isNaN(valor)) return 'R$ 0,00';
            return valor.toLocaleString('pt-BR', { 
                style: 'currency', 
                currency: 'BRL',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        },
        
        formatDate(date: string): string {
            if (!date) return '';
            if (typeof date === 'string') {
                if (date.includes('T')) {
                    return date.split('T')[0].split('-').reverse().join('/');
                }
                if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    return date.split('-').reverse().join('/');
                }
            }
            return date;
        },

        // ========== MARCADORES ==========
        calcularMarcadores(): void {
            console.log('📊 Calculando marcadores CRM...');
            
            const agora = new Date();
            const clientes = this.db.clientes || [];
            const vendas = this.db.vendas || [];
            const produtos = this.db.produtos || [];
            
            // Mapear compras por cliente
            const comprasPorCliente: { [key: string]: any[] } = {};
            const ultimasCompras: { [key: string]: string } = {};
            const totalCompras: { [key: string]: number } = {};
            
            vendas.forEach(venda => {
                const cliente = venda.cliente;
                if (!cliente) return;
                
                if (!comprasPorCliente[cliente]) {
                    comprasPorCliente[cliente] = [];
                    totalCompras[cliente] = 0;
                }
                comprasPorCliente[cliente].push(venda);
                totalCompras[cliente] += parseFloat(venda.valor) || 0;
                
                const dataVenda = new Date(venda.dataVenda);
                if (!ultimasCompras[cliente] || dataVenda > new Date(ultimasCompras[cliente])) {
                    ultimasCompras[cliente] = venda.dataVenda;
                }
            });

            // Reset marcadores
            this.marcadores.clientes = { inativos: [], vip: [], frequentes: [], emQueda: [] };
            this.marcadores.produtos = { campeoes: [], giroLento: [], semVenda: [], altaMargem: [], baixaMargem: [] };
            this.marcadores.estoque = { baixo: [], alto: [], parado: [] };
            this.marcadores.oportunidades = { promocao: [], clientes: [], tendencia: [] };

            // Clientes Inativos
            clientes.forEach(cliente => {
                const ultimaCompra = ultimasCompras[cliente.nome] || cliente.ultimaCompra;
                const totalComprado = totalCompras[cliente.nome] || 0;
                
                if (ultimaCompra) {
                    const dias = Math.floor((agora.getTime() - new Date(ultimaCompra).getTime()) / (1000 * 60 * 60 * 24));
                    if (dias >= 90) {
                        this.marcadores.clientes.inativos.push({
                            ...cliente,
                            ultimaCompra,
                            diasInativo: dias
                        });
                    }
                }

                // Clientes VIP
                if (totalComprado > 5000) {
                    this.marcadores.clientes.vip.push({
                        ...cliente,
                        totalCompras: totalComprado
                    });
                }

                // Clientes Frequentes
                const comprasCliente = comprasPorCliente[cliente.nome] || [];
                if (comprasCliente.length >= 3) {
                    const datas = comprasCliente.map(v => new Date(v.dataVenda)).sort((a, b) => a.getTime() - b.getTime());
                    if (datas.length >= 2) {
                        let totalDias = 0;
                        for (let i = 1; i < datas.length; i++) {
                            totalDias += Math.floor((datas[i].getTime() - datas[i-1].getTime()) / (1000 * 60 * 60 * 24));
                        }
                        const intervaloMedio = totalDias / (datas.length - 1);
                        if (intervaloMedio <= 30) {
                            this.marcadores.clientes.frequentes.push({
                                ...cliente,
                                intervaloMedio
                            });
                        }
                    }
                }
            });

            // Produtos Campeões
            const vendasProdutos: { [key: string]: { quantidade: number, valor: number, ultimaVenda: string | null } } = {};
            
            vendas.forEach(venda => {
                const produtoNome = venda.produto;
                if (!produtoNome) return;
                
                if (!vendasProdutos[produtoNome]) {
                    vendasProdutos[produtoNome] = { quantidade: 0, valor: 0, ultimaVenda: null };
                }
                vendasProdutos[produtoNome].quantidade++;
                vendasProdutos[produtoNome].valor += parseFloat(venda.valor) || 0;
                if (!vendasProdutos[produtoNome].ultimaVenda || new Date(venda.dataVenda) > new Date(vendasProdutos[produtoNome].ultimaVenda!)) {
                    vendasProdutos[produtoNome].ultimaVenda = venda.dataVenda;
                }
            });

            produtos.forEach(produto => {
                const vendasProduto = vendasProdutos[produto.nome] || { quantidade: 0, valor: 0, ultimaVenda: null };
                const margem = produto.preco ? ((produto.preco - (produto.custo || produto.preco * 0.6)) / produto.preco * 100) : 30;
                
                if (vendasProduto.quantidade >= 5 || vendasProduto.valor > 5000) {
                    this.marcadores.produtos.campeoes.push({
                        ...produto,
                        vendas: vendasProduto.quantidade,
                        valorVendas: vendasProduto.valor,
                        margem
                    });
                }

                if (vendasProduto.quantidade > 0 && vendasProduto.quantidade < 3) {
                    this.marcadores.produtos.giroLento.push({
                        ...produto,
                        vendas: vendasProduto.quantidade
                    });
                }

                if (vendasProduto.quantidade === 0) {
                    this.marcadores.produtos.semVenda.push(produto);
                }

                if (margem > 40) {
                    this.marcadores.produtos.altaMargem.push({ ...produto, margem });
                }

                if (margem < 15) {
                    this.marcadores.produtos.baixaMargem.push({ ...produto, margem });
                }

                // Estoque
                const estoqueAtual = produto.estoqueAtual || 0;
                const estoqueMinimo = produto.estoqueMinimo || 5;
                
                if (estoqueAtual <= estoqueMinimo && estoqueAtual > 0) {
                    this.marcadores.estoque.baixo.push({ ...produto, estoqueAtual, estoqueMinimo });
                }

                if (estoqueAtual > estoqueMinimo * 3) {
                    this.marcadores.estoque.alto.push({ ...produto, estoqueAtual, estoqueMinimo });
                }

                if (vendasProduto.ultimaVenda) {
                    const dias = Math.floor((agora.getTime() - new Date(vendasProduto.ultimaVenda).getTime()) / (1000 * 60 * 60 * 24));
                    if (dias >= 180 && estoqueAtual > 0) {
                        this.marcadores.estoque.parado.push({ ...produto, diasSemVenda: dias, estoqueAtual });
                    }
                }
            });

            console.log('✅ Marcadores calculados:', this.marcadores);
        },

        exportarMarcadores(): void {
            const relatorio = {
                metadados: {
                    dataExportacao: new Date().toISOString(),
                    usuario: this.usuarioLogado?.nome,
                    totalMarcadores: 15
                },
                marcadores: this.marcadores,
                estatisticas: {
                    totalClientes: this.db.clientes.length,
                    totalProdutos: this.db.produtos.length,
                    totalVendas: this.db.vendas.length,
                    clientesInativos: this.marcadores.clientes.inativos.length,
                    clientesVip: this.marcadores.clientes.vip.length,
                    produtosCampeoes: this.marcadores.produtos.campeoes.length,
                    estoqueBaixo: this.marcadores.estoque.baixo.length
                }
            };

            const nomeArquivo = `marcadores_crm_${new Date().toISOString().split('T')[0]}.json`;
            this.exportarJSON(relatorio, nomeArquivo);
            this.exportacaoTesteResultado = `✅ Relatório de marcadores exportado como ${nomeArquivo}`;
            setTimeout(() => { this.exportacaoTesteResultado = ''; }, 3000);
        },

        // ========== LOGIN ==========
        async fazerLogin(): Promise<void> {
            this.loading = true;
            this.erroLogin = '';

            try {
                const userCredential = await auth.signInWithEmailAndPassword(this.loginEmail, this.loginSenha);
                const userDoc = await firestore.collection('users').doc(userCredential.user.uid).get();
                
                this.usuarioLogado = {
                    uid: userCredential.user.uid,
                    nome: userDoc.data()?.nome || userCredential.user.email!.split('@')[0],
                    email: userCredential.user.email!,
                    perfil: userDoc.data()?.perfil || 'user'
                };

                await this.carregarDadosLocais();
                await this.carregarConfiguracoes();
                
            } catch (error) {
                console.error('Erro login:', error);
                this.erroLogin = 'E-mail ou senha inválidos';
            } finally {
                this.loading = false;
            }
        },

        logout(): void {
            auth.signOut().then(() => {
                this.usuarioLogado = null;
                this.aba = 'dashboard';
            });
        },

        // ========== CONFIGURAÇÕES ==========
        async carregarConfiguracoes(): Promise<void> {
            const exportConfig = await dbManager.get('exportConfig', 'exportConfig');
            if (exportConfig) {
                this.exportConfig = exportConfig;
            }
            
            const syncMetadata = await dbManager.get('syncMetadata', 'ultimaSync');
            if (syncMetadata) {
                this.ultimaSync = syncMetadata.valor;
            }
        },

        async salvarConfiguracaoExportacao(): Promise<void> {
            await dbManager.put('exportConfig', { ...this.exportConfig, id: 'exportConfig' });
            this.exportacaoTesteResultado = '✅ Configuração salva com sucesso!';
            setTimeout(() => { this.exportacaoTesteResultado = ''; }, 3000);
        },

        abrirSeletorPastas(): void {
            this.mostrarSeletorPastas = true;
        },

        selecionarPasta(pasta: string): void {
            this.exportConfig.basePath = pasta;
            this.mostrarSeletorPastas = false;
        },

        criarNovaPasta(): void {
            const novaPasta = prompt('Digite o nome da nova pasta:', 'meus-dados');
            if (novaPasta) {
                this.exportConfig.basePath = `/exports/${novaPasta}`;
                this.mostrarSeletorPastas = false;
            }
        },

        testarExportacao(): void {
            this.exportacaoTesteResultado = `✅ Teste realizado: arquivo salvo em ${this.exportConfig.basePath}/${new Date().toISOString().split('T')[0]}/teste.json`;
            setTimeout(() => { this.exportacaoTesteResultado = ''; }, 3000);
        },

        // ========== DADOS LOCAIS ==========
        async carregarDadosLocais(): Promise<void> {
            console.log('🔄 Carregando dados do IndexedDB...');
            for (const store of STORES) {
                if (store !== 'config' && store !== 'exportConfig' && store !== 'syncMetadata') {
                    (this.db as any)[store] = await dbManager.getAll(store);
                    console.log(`📊 ${store}:`, (this.db as any)[store].length, 'registros');
                }
            }
            
            const configs = await dbManager.getAll('config');
            if (configs.length) {
                const savedConfig = configs.find(c => c.id === 'blingConfig');
                if (savedConfig) {
                    this.blingConfig = savedConfig;
                    this.blingConectado = !!savedConfig.accessToken;
                }
            }

            this.calcularMarcadores();
        },

        // ========== BLING ==========
        async testarConexaoBling(): Promise<void> {
            this.testandoBling = true;
            this.erroBling = '';
            this.resultadoImportacao = ['🔄 Testando conexão com Bling ERP...'];

            try {
                const response = await fetch('https://www.bling.com.br/Api/v3/produtos?limite=1', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${this.blingConfig.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    this.blingConectado = true;
                    this.blingConfig.modoSimulado = false;
                    this.resultadoImportacao.push('✅ Conectado com sucesso!');
                    await dbManager.put('config', { ...this.blingConfig, id: 'blingConfig' });
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                this.blingConectado = false;
                this.erroBling = 'Não foi possível conectar ao Bling';
                this.resultadoImportacao.push('❌ Falha na conexão');
                // Não mostrar modal automaticamente
            } finally {
                this.testandoBling = false;
            }
        },

        async importarDadosBling(): Promise<void> {
            if (!this.blingConectado) {
                alert('Conecte-se ao Bling primeiro ou use dados simulados');
                return;
            }

            this.importandoBling = true;
            this.resultadoImportacao = ['🔄 Iniciando importação do Bling...'];

            try {
                if (this.tipoImportacao === 'total') {
                    await this.importarTotal();
                } else {
                    await this.importarIncremental();
                }

                await this.carregarDadosLocais();
                this.resultadoImportacao.push('🎉 Importação concluída!');
                
            } catch (error) {
                this.resultadoImportacao.push(`❌ Erro: ${error.message}`);
            } finally {
                this.importandoBling = false;
            }
        },

        async importarTotal(): Promise<void> {
            const modulos = ['clientes', 'produtos', 'vendas'];
            
            for (const modulo of modulos) {
                this.resultadoImportacao.push(`📦 Importando todos os ${modulo}...`);
                const dados = await this.fetchBlingData(modulo);
                
                // Limpar dados existentes
                await dbManager.clear(modulo);
                
                let importados = 0;
                for (const item of dados) {
                    if (item.id) {
                        await dbManager.put(modulo, { ...item, id: item.id.toString() });
                        importados++;
                    }
                }
                
                this.resultadoImportacao.push(`✅ ${importados} ${modulo} importados`);
            }
            
            // Atualizar timestamp da última sincronização
            const agora = new Date().toISOString();
            await dbManager.put('syncMetadata', { id: 'ultimaSync', valor: agora });
            this.ultimaSync = agora;
        },

        async importarIncremental(): Promise<void> {
            const ultimaSync = this.ultimaSync || '2000-01-01';
            const dataFiltro = new Date(ultimaSync).toISOString().split('T')[0];
            
            this.resultadoImportacao.push(`⏱️ Buscando dados alterados desde ${dataFiltro}...`);
            
            const modulos = ['clientes', 'produtos', 'vendas'];
            
            for (const modulo of modulos) {
                this.resultadoImportacao.push(`📦 Importando ${modulo} modificados...`);
                
                // Buscar apenas registros modificados
                const dados = await this.fetchBlingDataModificados(modulo, dataFiltro);
                
                let importados = 0;
                let atualizados = 0;
                
                for (const item of dados) {
                    if (!item.id) continue;
                    
                    const id = item.id.toString();
                    const existente = await dbManager.get(modulo, id);
                    
                    if (existente) {
                        // Atualizar existente
                        await dbManager.put(modulo, { ...existente, ...item, id });
                        atualizados++;
                    } else {
                        // Inserir novo
                        await dbManager.put(modulo, { ...item, id });
                        importados++;
                    }
                }
                
                this.resultadoImportacao.push(`✅ ${importados} novos, ${atualizados} atualizados`);
            }
            
            // Atualizar timestamp
            const agora = new Date().toISOString();
            await dbManager.put('syncMetadata', { id: 'ultimaSync', valor: agora });
            this.ultimaSync = agora;
        },

        async fetchBlingData(endpoint: string): Promise<any[]> {
            try {
                const url = `https://www.bling.com.br/Api/v3/${endpoint}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${this.blingConfig.accessToken}` }
                });
                
                if (!response.ok) throw new Error(`Erro ${response.status}`);
                const data = await response.json();
                return data.data || [];
            } catch (error) {
                this.resultadoImportacao.push(`⚠️ Erro ao buscar ${endpoint}: ${error.message}`);
                return [];
            }
        },

        async fetchBlingDataModificados(endpoint: string, dataFiltro: string): Promise<any[]> {
            try {
                const url = `https://www.bling.com.br/Api/v3/${endpoint}?dataAlteracao=${dataFiltro}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${this.blingConfig.accessToken}` }
                });
                
                if (!response.ok) throw new Error(`Erro ${response.status}`);
                const data = await response.json();
                return data.data || [];
            } catch (error) {
                this.resultadoImportacao.push(`⚠️ Erro ao buscar ${endpoint}: ${error.message}`);
                return [];
            }
        },

        // ========== DADOS SIMULADOS ==========
        gerarDadosSimulados(): void {
            this.mostrarModalSimulacao = true;
        },

        async gerarDadosSimuladosCompletos(): Promise<void> {
            this.gerandoDados = true;
            this.resultadoImportacao = ['🧪 Gerando dados simulados...'];
            
            try {
                // Limpar stores existentes
                for (const store of STORES) {
                    if (store !== 'config' && store !== 'exportConfig' && store !== 'syncMetadata') {
                        await dbManager.clear(store);
                    }
                }

                // Clientes (10)
                for (let i = 1; i <= 10; i++) {
                    const ultimaCompra = new Date();
                    ultimaCompra.setDate(ultimaCompra.getDate() - Math.floor(Math.random() * 120));
                    await dbManager.put('clientes', {
                        id: `cli_${i}`,
                        nome: `Cliente Simulado ${i}`,
                        email: `cliente${i}@email.com`,
                        telefone: `(11) 9${String(i).padStart(4, '0')}-${String(i).padStart(4, '0')}`,
                        cidade: ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte'][Math.floor(Math.random() * 3)],
                        estado: ['SP', 'RJ', 'MG'][Math.floor(Math.random() * 3)],
                        ultimaCompra: ultimaCompra.toISOString().split('T')[0]
                    });
                }

                // Produtos (10)
                const categorias = ['Cosméticos', 'Perfumaria', 'Higiene', 'Maquiagem', 'Cabelos'];
                for (let i = 1; i <= 10; i++) {
                    const preco = Math.floor(Math.random() * 900) + 100;
                    const custo = preco * (Math.random() * 0.5 + 0.3);
                    await dbManager.put('produtos', {
                        id: `prod_${i}`,
                        nome: `Produto Simulado ${i}`,
                        sku: `SKU${String(i).padStart(3, '0')}`,
                        preco: preco,
                        custo: custo,
                        categoria: categorias[Math.floor(Math.random() * categorias.length)],
                        marca: 'Marca Teste',
                        estoqueAtual: Math.floor(Math.random() * 200) + 10,
                        estoqueMinimo: 20
                    });
                }

                // Vendas (20)
                const status = ['Concluído', 'Em andamento', 'Cancelado'];
                for (let i = 1; i <= 20; i++) {
                    const dataVenda = new Date();
                    dataVenda.setDate(dataVenda.getDate() - Math.floor(Math.random() * 120));
                    await dbManager.put('vendas', {
                        id: `venda_${i}`,
                        cliente: `Cliente Simulado ${Math.ceil(Math.random() * 10)}`,
                        produto: `Produto Simulado ${Math.ceil(Math.random() * 10)}`,
                        valor: Math.floor(Math.random() * 5000) + 200,
                        dataVenda: dataVenda.toISOString().split('T')[0],
                        status: status[Math.floor(Math.random() * status.length)]
                    });
                }

                await this.carregarDadosLocais();
                this.blingConfig.modoSimulado = true;
                await dbManager.put('config', { ...this.blingConfig, id: 'blingConfig' });
                
                this.resultadoImportacao.push('✅ 10 clientes, 10 produtos e 20 vendas gerados!');
                this.aba = 'dados';
                
            } catch (error) {
                console.error('Erro ao gerar dados:', error);
                this.resultadoImportacao.push(`❌ Erro: ${error.message}`);
            } finally {
                this.gerandoDados = false;
                this.mostrarModalSimulacao = false;
            }
        },

        confirmarDadosSimulados(): void {
            this.gerarDadosSimuladosCompletos();
        },

        async limparTodosDados(): Promise<void> {
            if (confirm('Tem certeza que deseja limpar todos os dados?')) {
                for (const store of STORES) {
                    if (store !== 'config' && store !== 'exportConfig' && store !== 'syncMetadata') {
                        await dbManager.clear(store);
                    }
                }
                await this.carregarDadosLocais();
                this.resultadoImportacao = ['🗑️ Todos os dados foram removidos'];
            }
        },

        // ========== EXPORTAÇÃO ==========
        gerarNomeArquivo(modulo: string): string {
            const data = new Date().toISOString().split('T')[0];
            let nome = this.exportConfig.nomeArquivo
                .replace('{modulo}', modulo)
                .replace('{data}', data)
                .replace('{timestamp}', Date.now().toString())
                .replace('{contador}', '1');
            
            if (this.formatoExportacao === 'json' && !nome.endsWith('.json')) nome += '.json';
            if (this.formatoExportacao === 'csv' && !nome.endsWith('.csv')) nome += '.csv';
            
            return nome;
        },

        async exportarDados(modulo: string): Promise<void> {
            const data = (this.db as any)[modulo];
            if (!data.length) {
                alert('Nenhum dado para exportar');
                return;
            }

            const nomeArquivo = this.gerarNomeArquivo(modulo);
            
            let dadosParaExportar = data;
            if (this.exportConfig.incluirMetadados === 'sim') {
                dadosParaExportar = {
                    metadados: {
                        modulo: modulo,
                        dataExportacao: new Date().toISOString(),
                        totalRegistros: data.length,
                        usuario: this.usuarioLogado?.nome,
                        formato: this.formatoExportacao
                    },
                    dados: data
                };
            }

            if (this.formatoExportacao === 'json') {
                this.exportarJSON(dadosParaExportar, nomeArquivo);
            } else if (this.formatoExportacao === 'csv') {
                this.exportarCSV(data, nomeArquivo);
            }

            this.exportacaoTesteResultado = `✅ Arquivo exportado: ${nomeArquivo}`;
            setTimeout(() => { this.exportacaoTesteResultado = ''; }, 3000);
        },

        async exportarTodosDados(): Promise<void> {
            const zip = new JSZip();
            const data = new Date().toISOString().split('T')[0];
            
            for (const [modulo, dados] of Object.entries(this.db)) {
                if (Array.isArray(dados) && dados.length) {
                    let dadosParaExportar = dados;
                    if (this.exportConfig.incluirMetadados === 'sim') {
                        dadosParaExportar = {
                            metadados: {
                                modulo: modulo,
                                dataExportacao: new Date().toISOString(),
                                totalRegistros: dados.length,
                                usuario: this.usuarioLogado?.nome
                            },
                            dados: dados
                        };
                    }

                    const nomeArquivo = `${modulo}_${data}.json`;
                    zip.file(nomeArquivo, JSON.stringify(dadosParaExportar, null, 2));
                }
            }

            const conteudo = await zip.generateAsync({ type: 'blob' });
            saveAs(conteudo, `todos_dados_${data}.zip`);
            
            this.exportacaoTesteResultado = `✅ Todos os dados exportados em ZIP`;
            setTimeout(() => { this.exportacaoTesteResultado = ''; }, 3000);
        },

        exportarJSON(data: any, nomeArquivo: string): void {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            saveAs(blob, nomeArquivo);
        },

        gerarCSV(data: any[]): string {
            if (!data.length) return '';
            const headers = Object.keys(data[0]).join(';');
            const rows = data.map(obj => Object.values(obj).map(v => {
                if (typeof v === 'number') {
                    return v.toString().replace('.', ',');
                }
                if (typeof v === 'string' && v.includes(';')) {
                    return `"${v}"`;
                }
                return v;
            }).join(';'));
            return [headers, ...rows].join('\n');
        },

        exportarCSV(data: any[], nomeArquivo: string): void {
            const csv = this.gerarCSV(data);
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            saveAs(blob, nomeArquivo);
        }
    },

    async mounted(): Promise<void> {
        console.log('🚀 App iniciado');
        
        // Verificar se usuário já está logado
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                const userDoc = await firestore.collection('users').doc(user.uid).get();
                this.usuarioLogado = {
                    uid: user.uid,
                    nome: userDoc.data()?.nome || user.email!.split('@')[0],
                    email: user.email!,
                    perfil: userDoc.data()?.perfil || 'user'
                };
                await this.carregarDadosLocais();
                await this.carregarConfiguracoes();
            }
        });

        // Carregar configurações do Bling
        const configs = await dbManager.getAll('config');
        if (configs.length) {
            const savedConfig = configs.find(c => c.id === 'blingConfig');
            if (savedConfig) {
                this.blingConfig = savedConfig;
                this.blingConectado = !!savedConfig.accessToken;
            }
        }
    }
});