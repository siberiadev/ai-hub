/**
 * Стабильные эндпоинты и scopes WHOOP API v2 — зашиты в код (не меняются от деплоя к деплою,
 * поэтому не выносятся в env). Менять только при смене самого API WHOOP.
 */
export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
export const WHOOP_SCOPES =
  'offline read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout';
