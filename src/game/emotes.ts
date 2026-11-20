// Emoticonos que se pueden enviar durante la partida (se ven un momento junto al nombre de quien los manda).
export const EMOTES = ['😂', '😱', '😈', '👏', '😡', '🤔', '😭', '💀', '🙏', '👍', '🔥', '🫣'] as const;
export const isEmote = (x: unknown): x is string => typeof x === 'string' && (EMOTES as readonly string[]).includes(x);
