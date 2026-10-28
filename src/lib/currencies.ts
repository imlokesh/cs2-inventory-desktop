// Steam market currency ids, keyed by ISO code.
// prettier-ignore
export const CURRENCIES = { USD: 1, GBP: 2, EUR: 3, CHF: 4, RUB: 5, PLN: 6, BRL: 7, JPY: 8, SEK: 9, IDR: 10, MYR: 11, SGD: 13, THB: 14, VND: 15, KRW: 16, TRY: 17, UAH: 18, MXN: 19, CAD: 20, AUD: 21, NZD: 22, CNY: 23, INR: 24, CLP: 25, PEN: 26, COP: 27, ZAR: 28, HKD: 29, TWD: 30, SAR: 31, AED: 32, ARS: 34, ILS: 35, KZT: 37, KWD: 38, QAR: 39, CRC: 40, UYU: 41 } as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number, currency: CurrencyCode, compact = false) {
  const key = `${currency}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    });
    formatters.set(key, f);
  }
  return f.format(value);
}

/**
 * Steam returns prices as localized strings ("$1,234.56", "1.234,56€", "12,--€", "¥ 1,234").
 * Turn them into numbers without knowing the locale up front.
 */
export function parseSteamPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/--/g, "00").replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!s) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = s.split(sep);
    // "1,234" / "1.234.567" are thousands groupings; "1,23" / "0.5" are decimals.
    const isThousands = parts.length > 2 || parts[parts.length - 1].length === 3;
    s = isThousands ? parts.join("") : parts.join(".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
