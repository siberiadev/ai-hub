/** Аккаунт WHOOP не подключён (нет токена). Воркер синка трактует особо — не жжёт попытки. */
export class WhoopNotConnectedError extends Error {
  constructor(message = 'WHOOP не подключён — пройдите /whoop/oauth/start.') {
    super(message);
    this.name = 'WhoopNotConnectedError';
  }
}
