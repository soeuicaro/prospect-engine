/** Normalizes a CNPJ string to 14 raw digits. */
export function normalizeCnpj(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 14 ? digits : null;
}

/** Formats 14 digits as XX.XXX.XXX/XXXX-XX. */
export function formatCnpj(digits: string | null | undefined): string | null {
  const cnpj = normalizeCnpj(digits ?? "");
  if (!cnpj) return null;
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Validates the CNPJ check-digit algorithm (format validity only). */
export function isValidCnpj(raw: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(raw ?? "");
  if (!cnpj) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base: string, weights: number[]) => {
    const sum = base
      .split("")
      .reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(cnpj.slice(0, 12), w1);
  const d2 = calc(cnpj.slice(0, 12) + d1, w2);

  return cnpj === cnpj.slice(0, 12) + String(d1) + String(d2);
}

/** Extracts the 8-digit CNPJ "root" (matriz identifier) shared by all filiais. */
export function cnpjRoot(raw: string | null | undefined): string | null {
  const cnpj = normalizeCnpj(raw ?? "");
  return cnpj ? cnpj.slice(0, 8) : null;
}
