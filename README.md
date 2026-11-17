# Status-Report
Gerador de status report simples para homologações.

**Acesse:** https://pchiesi.github.io/Status-Report/

## O que faz

| Aba | Para quê |
|---|---|
| **Projeto** | Nome, release, ambiente, período, escopo e responsável. Backup/importação dos dados em JSON. |
| **Plano de teste** | Suba o plano em `.xlsx`, `.xls`, `.csv` ou `.json`. As colunas de ID, cenário, módulo, responsável e status são identificadas automaticamente (dá para ajustar o mapeamento). O status de cada cenário pode ser atualizado na própria tabela. |
| **Bugs** | Cadastro de bugs com severidade, status, módulo, responsável, cenário relacionado e link (Jira/Azure etc.). |
| **Status do dia** | Comentários por data: resumo, destaques, riscos, impedimentos e próximos passos. |
| **Report** | Monta o report da data escolhida: status geral (verde/amarelo/vermelho), indicadores, execução por módulo, comentários do dia, bugs em aberto e cenários com falha/bloqueados. Exporta como texto (Teams/Slack), e-mail (HTML), arquivo HTML ou PDF. |

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
