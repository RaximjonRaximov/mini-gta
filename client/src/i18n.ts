export type Lang = 'uz' | 'en';

const dict: Record<Lang, Record<string, string>> = {
  uz: {
    help: 'WASD / arrows — harakat · Shift — yugurish · Sichqoncha chap tugmasi — o\'q · Space — mashina kir/chiq · E — o\'zaro ta\'sir',
    fps: 'FPS',
    ping: 'Ping',
    players: 'O\'yinchilar',
    wanted: 'Qidiruv',
    money: 'Pul',
    host: 'HOST',
    join: 'JOIN',
    namePlaceholder: 'Ismingiz',
    mapPlaceholder: 'Xarita nomi',
    create: 'Yaratish',
    joinCode: 'Kod bilan qo\'shilish',
  },
  en: {
    help: 'WASD / arrows — move · Shift — sprint · Left click — shoot · Space — enter/exit vehicle · E — interact',
    fps: 'FPS',
    ping: 'Ping',
    players: 'Players',
    wanted: 'Wanted',
    money: 'Money',
    host: 'HOST',
    join: 'JOIN',
    namePlaceholder: 'Your name',
    mapPlaceholder: 'Map name',
    create: 'Create',
    joinCode: 'Join by code',
  },
};

let current: Lang = 'uz';

export function setLang(lang: Lang): void { current = lang; }
export function getLang(): Lang { return current; }
export function t(key: string): string { return dict[current][key] ?? key; }
