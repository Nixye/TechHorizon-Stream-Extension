# TechHorizon Vortex — Discord Activity

Site e Activity para transmitir uma aba ou janela com vídeo e áudio e assistir em grupo. O transmissor escolhe a fonte no navegador; os espectadores assistem pelo site ou dentro da Activity, alternando entre até seis transmissões. O áudio acompanha apenas a transmissão selecionada.

**Site:** https://techhorizon-stream-activity.black-bones-4543.chatgpt.site  
**Relay:** https://techhorizon-vortex-relay.lunawillerp.workers.dev  
**Aplicativo Discord:** `1553857876232241263`

O site e a API de salas são publicados pelo Codex Sites e usam D1. O relay de mídia fica em `relay/`, publicado na conta Cloudflare da TechHorizon como Worker com um Durable Object por sala. Ele encaminha segmentos WebM por WebSocket e mantém apenas o último segmento em memória para novos espectadores. O Render, o Stage e o GoonTogether não participam desta versão.

## Fluxo

1. Crie ou entre em uma sala pelo site ou pela Activity.
2. Clique em **Transmitir**. A captura abre no navegador para escolher uma aba ou janela, com a opção de áudio oferecida pelo navegador. O compartilhamento de tela inteira é recusado.
3. Quem tem o código pode assistir, transmitir, alternar entre streams, ativar o som e usar o modo foco.

O navegador recebe `systemAudio: exclude` e `windowAudio: window` ao solicitar a captura. Esses parâmetros não garantem áudio isolado de todo aplicativo nativo; o suporte depende do navegador e do sistema. A opção mais confiável costuma ser capturar uma aba com áudio.

## Publicação

O checkout `codex-site/` tem Git próprio e é publicado pelo Codex Sites. O Worker em `relay/` usa `npm ci`, `npm run check` e `npm run deploy` com uma conta Cloudflare autenticada. No Discord Developer Portal, os URL Mappings são:

| Prefixo | Alvo |
| --- | --- |
| `/relay` | `techhorizon-vortex-relay.lunawillerp.workers.dev` |
| `/` | `techhorizon-stream-activity.black-bones-4543.chatgpt.site` |

O mapeamento do relay permite que o iframe do Discord abra o WebSocket. A Activity ainda depende da disponibilidade de WebSocket e reprodução WebM no cliente Discord. A disponibilidade da Activity fora dos servidores de desenvolvimento também depende da publicação/revisão do aplicativo no Discord.

Salas sem atividade expiram após seis horas. O limite atual é de 20 espectadores e seis transmissões simultâneas por sala.
