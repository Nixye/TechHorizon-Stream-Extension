# TechHorizon Stream — Discord Activity

Activity e site próprios para compartilhar uma aba ou janela de aplicativo. O vídeo e o áudio capturados seguem diretamente por WebRTC entre transmissor e espectadores. O site usa sua própria API de sinalização e um banco D1 para coordenar as conexões; não usa Render, Stage ou GoonTogether no caminho da transmissão.

**Site publicado:** https://techhorizon-stream-activity.black-bones-4543.chatgpt.site

**Aplicativo Discord:** `1553857876232241263`. O mapeamento raiz `/` aponta para o domínio acima.

## Código atual

O código publicado fica no checkout `codex-site/`, gerenciado pelo Codex Sites em um repositório Git próprio. Veja `codex-site/README.md` para a arquitetura e os comandos. Este repositório raiz preserva a implementação Node/WebSocket anterior apenas como histórico; a Activity publicada não a usa.

## Como usar

1. Inicie a Activity no Discord ou abra o site. Crie uma sala: você entra nela automaticamente.
2. Clique em **Abrir captura com áudio**. Na nova aba, clique em **Compartilhar aplicativo** e escolha uma aba ou janela. Ative o áudio dessa fonte quando o navegador oferecer. A tela inteira é recusada.
3. Compartilhe somente o código da sala. Os espectadores entram pela Activity ou pelo site, clicam em **Ativar som** para ouvir e podem usar **Modo foco**.

O site pede ao navegador áudio da janela ou aba com `systemAudio: exclude` e `windowAudio: window`. Esses parâmetros são preferências; navegadores e sistemas podem não fornecer áudio isolado de um aplicativo nativo. Uma aba com áudio é a opção mais confiável. Para garantir isolamento de áudio de um jogo Windows, será necessário um capturador nativo complementar.

As salas expiram depois de 6 horas sem atividade. Há limite de 20 espectadores; o upload do transmissor cresce a cada espectador. Sem servidor TURN, conexões em redes restritivas podem falhar. A verificação da Activity pelo Discord ainda é necessária para disponibilizá-la a usuários de servidores fora da equipe de desenvolvimento.

## Referências

- [Discord Activities overview](https://docs.discord.com/developers/activities/overview)
- [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API)
