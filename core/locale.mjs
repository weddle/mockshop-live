// Canonical browser locales can differ from a pinned app's locale identifiers.
export function resolveLocale(m, requested) {
  const cfg=m.localization || {};
  let code=requested || cfg.default || 'en-US';
  const alias=Object.entries(cfg.aliases || {}).find(([a])=>a.toLowerCase()===String(code).toLowerCase());
  if(alias) code=alias[1];
  const supported=cfg.locales || [];
  if(supported.length) {
    const exact=supported.find(c=>c.toLowerCase()===String(code).toLowerCase());
    const lang=String(code).split('-')[0].toLowerCase();
    const base=supported.find(c=>c.toLowerCase()===lang) || supported.find(c=>c.toLowerCase().split('-')[0]===lang);
    if(!exact && !base) throw new Error(`${m.name}: unsupported locale ${code}; supported: ${supported.join(', ')}`);
    code=exact || base;
  }
  const browserLocale=Intl.getCanonicalLocales(code)[0];
  return {code:browserLocale,appLocale:cfg.app_locales?.[code] || code,cookie:cfg.cookie};
}

export function localizeUser(m, locale, method, route, value) {
  const fields=m.localization?.user_fields?.[`${method} ${route}`];
  if(!fields || !value || typeof value!=='object') return value;
  const copy=structuredClone(value);
  for(const field of fields) {
    const keys=field.split('.');let target=copy;
    for(const key of keys.slice(0,-1)) target=target[key] ||= {};
    target[keys.at(-1)]=locale.appLocale;
  }
  return copy;
}
