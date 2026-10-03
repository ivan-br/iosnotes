// Prices are represented in integer ticks. Never floor/ceil a floating price/step quotient.
export function precision(value: string): number {
  const normalized = expand(value).replace(/0+$/, "");
  return normalized.includes(".") ? normalized.split(".")[1].length : 0;
}

export function expand(value: string): string {
  if (!/[eE]/.test(value)) return value;
  const [coefficient, exponent] = value.toLowerCase().split("e");
  if (!Number.isInteger(Number(exponent)) || Math.abs(Number(exponent)) > 100)
    throw new Error("Invalid decimal exponent");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  return (
    digits.padEnd(point, "0").slice(0, point) +
    (point < digits.length ? `.${digits.slice(point)}` : "")
  );
}

export function units(value: string, digits: number): number {
  const expanded = expand(value);
  if (!/^\d+(?:\.\d+)?$/.test(expanded)) throw new Error("Invalid decimal");
  const [whole, fraction = ""] = expanded.split(".");
  if (fraction.slice(digits).replace(/0/g, ""))
    throw new Error("Price is not aligned to precision");
  const result = Number(whole + fraction.slice(0, digits).padEnd(digits, "0"));
  if (!Number.isSafeInteger(result))
    throw new Error("Price exceeds safe tick precision");
  return result;
}

export function decimal(value: number, digits: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid tick value");
  const text = String(value).padStart(digits + 1, "0");
  return digits ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
}

export function defaultStep(price: number, tick: string): string {
  const digits = precision(tick);
  const tickUnits = units(tick, digits);
  const target =
    price >= 50000
      ? 200
      : price >= 10000
        ? 50
        : price >= 1000
          ? 10
          : price >= 100
            ? 1
            : price >= 10
              ? 0.1
              : price >= 0.1
                ? 0.01
                : price >= 0.01
                  ? 0.001
                  : price > 0
                    ? price * 0.05
                    : Number(tick);
  const power = 10 ** Math.floor(Math.log10(target));
  const normalized = target / power;
  const nice = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * power;
  const count = Math.max(1, Math.round(nice / Number(tick)));
  return decimal(count * tickUnits, digits);
}

export function validateStep(value: string, tick: string): string {
  const digits = precision(tick);
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized))
    throw new Error("Enter a positive decimal price step");
  const step = units(normalized, digits);
  const tickSize = units(tick, digits);
  if (step <= 0 || step % tickSize !== 0)
    throw new Error(`Use a positive multiple of ${tick}`);
  return decimal(step, digits);
}

export function quantity(value: number, lot: string): string {
  if (value === 0) return "0";
  const digits = Math.min(16, precision(lot));
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  const text = value.toFixed(digits);
  if (Number(text) === 0) return expand(value.toPrecision(3));
  return digits ? text.replace(/\.?0+$/, "") : text;
}
