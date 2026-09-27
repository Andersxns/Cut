// A small, safe calculator: tokenizer + recursive-descent parser. No eval.
//
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/' | 'mod' | implicit) unary)*
//   unary   := ('-' | '+') unary | power
//   power   := postfix ('^' unary)?
//   postfix := primary ('!' | '%' | '°')*
//   primary := number | constant | func '(' expr ')' | func primary | '(' expr ')'

const FUNCS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10,
  log10: Math.log10, log2: Math.log2,
};
const CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E, tau: 2 * Math.PI, τ: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, φ: (1 + Math.sqrt(5)) / 2 };

class CalcError extends Error {}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|(\*\*|[-+*/^%!()°])|(log10|log2|[a-zπτφ]+))/gy;
  let m;
  while (re.lastIndex < src.length) {
    const start = re.lastIndex;
    m = re.exec(src);
    if (!m || m.index !== start) {
      if (/^\s*$/.test(src.slice(start))) break;
      throw new CalcError('unexpected input');
    }
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'op', v: m[2] === '**' ? '^' : m[2] });
    else {
      const word = m[3];
      if (word === 'mod') tokens.push({ t: 'op', v: 'mod' });
      else if (word === 'deg') tokens.push({ t: 'op', v: '°' });
      else if (word in FUNCS) tokens.push({ t: 'fn', v: word });
      else if (word in CONSTS) tokens.push({ t: 'num', v: CONSTS[word], c: true });
      else throw new CalcError('unknown word');
    }
  }
  return tokens;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw new CalcError('factorial domain');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function parse(tokens) {
  let i = 0;
  let ops = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const startsOperand = () => {
    const tk = peek();
    // Implicit multiplication only before constants, functions and brackets
    // ("2pi", "3(4+5)") — never between two bare numbers.
    return tk && ((tk.t === 'num' && tk.c) || tk.t === 'fn' || (tk.t === 'op' && tk.v === '('));
  };

  function primary() {
    const tk = tokens[i++];
    if (!tk) throw new CalcError('unexpected end');
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'fn') {
      ops++;
      const arg = isOp('(') ? (i++, expectClose(expr())) : power();
      return FUNCS[tk.v](arg);
    }
    if (tk.t === 'op' && tk.v === '(') return expectClose(expr());
    throw new CalcError('unexpected token');
  }
  function expectClose(value) {
    if (isOp(')')) i++;
    else if (peek()) throw new CalcError('missing )');
    return value;
  }
  function postfix() {
    let v = primary();
    for (;;) {
      if (isOp('!')) {
        i++, ops++;
        v = factorial(v);
      } else if (isOp('°')) {
        i++, ops++;
        v = (v * Math.PI) / 180;
      } else if (isOp('%')) {
        // "10 % 3" is modulo; a trailing "50%" is a percentage.
        const next = tokens[i + 1];
        if (next && (next.t === 'num' || next.t === 'fn' || (next.t === 'op' && next.v === '('))) break;
        i++, ops++;
        v = v / 100;
      } else break;
    }
    return v;
  }
  function power() {
    const base = postfix();
    if (isOp('^')) {
      i++, ops++;
      return base ** unary();
    }
    return base;
  }
  function unary() {
    if (isOp('-')) return i++, -unary();
    if (isOp('+')) return i++, unary();
    return power();
  }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('%') || isOp('mod')) {
        const op = tokens[i++].v;
        ops++;
        const rhs = unary();
        if (op === '*') v *= rhs;
        else if (op === '/') v /= rhs;
        else v %= rhs;
      } else if (startsOperand()) {
        ops++;
        v *= unary(); // implicit multiplication: 2pi, 3(4+5)
      } else break;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].v;
      ops++;
      const rhs = term();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  const value = expr();
  if (i < tokens.length) throw new CalcError('trailing input');
  return { value, ops };
}

function normalize(query) {
  return query
    .toLowerCase()
    .replace(/^(what\s+is|what's|whats|calculate|calc|compute|solve|evaluate)\s+/, '')
    .replace(/[=?]+\s*$/, '')
    .replace(/[×✕·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d)\s*x\s*(?=[\d(.])/g, '$1*')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/g, '($1/100)*')
    .replace(/\bsquare root of\s*/g, 'sqrt ')
    .replace(/\btimes\b/g, '*')
    .replace(/\b(divided by|over)\b/g, '/')
    .replace(/\bplus\b/g, '+')
    .replace(/\bminus\b/g, '-')
    .replace(/\bto the power of\b/g, '^')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatResult(x) {
  if (Object.is(x, -0)) x = 0;
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return x.toLocaleString('en-US');
  const p = Number(x.toPrecision(12));
  if (Math.abs(p) >= 1e21 || (p !== 0 && Math.abs(p) < 1e-7)) return p.toExponential(8).replace(/\.?0+e/, 'e');
  return p.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

export function calculate(query) {
  const src = normalize(query);
  if (!src || src.length > 200 || !/[\dπτφ]|pi|tau|phi/.test(src)) return null;
  // Things that are numbers-with-dashes but not sums: dates, phone numbers.
  if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{3}-\d{3,4}$|^\+?\d+(-\d+){2,}$|^\d+$/.test(src)) return null;
  try {
    const { value, ops } = parse(tokenize(src));
    if (ops === 0 || !Number.isFinite(value)) return null;
    const pretty = src.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/(?<=\S)([+^])(?=\S)/g, ' $1 ').replace(/(?<=[\d)])-(?=\S)/g, ' − ').replace(/\s+/g, ' ');
    return { type: 'calc', expression: pretty, result: formatResult(value), value };
  } catch {
    return null;
  }
}
