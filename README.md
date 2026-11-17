# Status-Report
Gerador de status report simples para homologações.

**Acesse:** https://pchiesi.github.io/Status-Report/

## O que faz

| Aba | Para quê |
|---|---|
| **Projeto** | Nome, release, ambiente, período, escopo e responsável. Backup/importação dos dados em JSON. |
| **Plano de teste** | Duas opções: baixar o **caderno padrão** (.xlsx), preencher e subir, ou **importar o caderno de testes da própria pessoa**, configurando os campos. O status de cada cenário pode ser atualizado na própria tabela. |
| **Bugs** | Cadastro de bugs com severidade, status, módulo, responsável, cenário relacionado e link (Jira/Azure etc.). |
| **Status do dia** | Comentários por data: resumo, destaques, riscos, impedimentos e próximos passos. |
| **Report** | Monta o report da data escolhida com seções, indicadores e gráficos **configuráveis**. Exporta como texto (Teams/Slack), e-mail (HTML), arquivo HTML ou PDF. |

### Importar o próprio caderno de testes
Ao subir uma planilha em formato próprio, abre a **Configuração da importação**:
- **Aba** e **linha do cabeçalho**: detectadas automaticamente (funciona com capa/título acima da tabela).
- **Campos do report**: qual coluna corresponde a ID, Cenário, Módulo, Responsável, Prioridade, Data de execução, Bug relacionado e Status.
- **Campos extras**: outras colunas (Ciclo, Sistema, Tipo de teste…) que passam a aparecer na tabela, na busca e nos gráficos.
- **Valores de status**: cada valor encontrado (ex.: `OK`, `NOK`, `Aguardando massa`) é ligado a um status do report.
- **Salvar como modelo**: na próxima vez que uma planilha com as mesmas colunas for importada, a configuração é aplicada sozinha. Modelos podem ser exportados/importados em `.json` para compartilhar com o time.

### Gráficos configuráveis
No painel **Configurar report** dá para ligar/desligar seções e indicadores e montar os gráficos:
- **Tipo:** barras horizontais, colunas, rosca ou tabela.
- **Dados:** cenários de teste ou bugs.
- **Agrupar por / dividir por:** status, módulo, responsável, prioridade, data, severidade, aberto/fechado ou qualquer campo extra importado.
- Opções de 100%, limite de itens (agrupa o resto em "Outros"), reordenar, duplicar e restaurar o padrão.

### Status reconhecidos no plano
`Passou / Passed / OK / Aprovado`, `Falhou / Failed / Reprovado`, `Bloqueado / Blocked / Impedido`,
`Em andamento / In progress / Reteste`, `Não executado / Pendente / vazio`, `N/A / Cancelado`.

### Regras do status geral (automático)
- **Vermelho:** bug crítico aberto, taxa de sucesso < 70%, ≥ 15% bloqueado ou prazo vencido com execução incompleta.
- **Amarelo:** bug alto aberto, taxa de sucesso < 90%, cenários bloqueados, impedimento no dia ou execução 20 p.p. abaixo do tempo decorrido.
- **Verde:** nenhum dos anteriores. Pode ser sobrescrito manualmente na aba Projeto.

## Onde ficam os dados
Tudo roda no navegador, sem servidor: os dados ficam no `localStorage` de quem usa. Para levar para outra máquina ou passar para alguém do time, use **Exportar backup** / **Importar backup**.

## Rodar localmente
Abra `index.html` no navegador (ou `python3 -m http.server`).

## Publicação
O workflow `.github/workflows/pages.yml` publica o site no GitHub Pages a cada push na `main`.
Na primeira vez, em **Settings → Pages**, escolha **Source: GitHub Actions**.

Leitura de Excel via [SheetJS](https://sheetjs.com/) (Apache-2.0), incluído em `vendor/`.
