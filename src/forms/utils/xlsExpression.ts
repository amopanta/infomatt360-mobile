/** Safe evaluator for common XLSForm expressions. No JavaScript eval. */
// Copia exacta de frontend/src/modules/runtime/xlsExpression.ts (H03: mismo
// evaluador en web y app). Si cambia allá, copiarlo aquí; test/xlsParity.test.ts
// repite los casos de la web.
type RuntimeFormValues = Record<string, unknown>;

type Token = { kind: 'field' | 'number' | 'string' | 'identifier' | 'operator' | 'punctuation'; value: string };
const precedence: Record<string, number> = { or: 1, and: 2, '=': 3, '!=': 3, '>': 3, '<': 3, '>=': 3, '<=': 3, '+': 4, '-': 4, '*': 5, '/': 5 };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < expression.length) {
    const rest = expression.slice(position);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { position += whitespace[0].length; continue; }
    const field = rest.match(/^\$\{([\w.-]+)\}/);
    if (field) { tokens.push({ kind: 'field', value: field[1] }); position += field[0].length; continue; }
    const string = rest.match(/^(['"])((?:\\.|(?!\1)[^\\])*)\1/);
    if (string) { tokens.push({ kind: 'string', value: string[2].replace(/\\(['"\\])/g, '$1') }); position += string[0].length; continue; }
    const number = rest.match(/^\d+(?:\.\d+)?/);
    if (number) { tokens.push({ kind: 'number', value: number[0] }); position += number[0].length; continue; }
    const operator = rest.match(/^(?:!=|>=|<=|[=<>+*/-])/);
    if (operator) { tokens.push({ kind: 'operator', value: operator[0] }); position += operator[0].length; continue; }
    const identifier = rest.match(/^[A-Za-z_][\w-]*/);
    if (identifier) { tokens.push({ kind: ['and', 'or'].includes(identifier[0].toLowerCase()) ? 'operator' : 'identifier', value: identifier[0].toLowerCase() }); position += identifier[0].length; continue; }
    if ('(),.'.includes(rest[0])) { tokens.push({ kind: 'punctuation', value: rest[0] }); position += 1; continue; }
    throw new Error(`Expresión XLSForm no compatible cerca de «${rest.slice(0, 12)}»`);
  }
  return tokens;
}

function numeric(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function localToday(): string { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' || typeof right === 'number') return numeric(left) - numeric(right);
  return String(left ?? '').localeCompare(String(right ?? ''));
}

export function evaluateXlsExpression(expression: string, values: RuntimeFormValues, option: Record<string, unknown> = {}, current: unknown = null, pulls: Record<string, string> = {}): unknown {
  const tokens = tokenize(expression);
  let position = 0;
  function parse(minimum = 0): unknown {
    const token = tokens[position++];
    if (!token) throw new Error('Expresión XLSForm incompleta');
    let left: unknown;
    if (token.kind === 'number') left = Number(token.value);
    else if (token.kind === 'string') left = token.value;
    else if (token.kind === 'field') left = values[token.value];
    else if (token.value === '.') left = current;
    else if (token.value === '(') { left = parse(); if (tokens[position++]?.value !== ')') throw new Error('Paréntesis sin cerrar'); }
    else if (token.value === '-' || token.value === 'not') left = token.value === '-' ? -numeric(parse(6)) : !Boolean(parse(6));
    else if (token.kind === 'identifier') {
      if (tokens[position]?.value === '(') {
        position++;
        const args: unknown[] = [];
        if (tokens[position]?.value !== ')') {
          while (true) { args.push(parse()); if (tokens[position]?.value !== ',') break; position++; }
        }
        if (tokens[position++]?.value !== ')') throw new Error('Función sin cerrar');
        switch (token.value) {
          case 'selected': left = Array.isArray(args[0]) ? args[0].map(String).includes(String(args[1])) : String(args[0] ?? '').split(/[\s,]+/).includes(String(args[1])); break;
          case 'string-length': left = String(args[0] ?? '').length; break;
          case 'number': left = numeric(args[0]); break;
          case 'int': left = Math.trunc(numeric(args[0])); break;
          case 'round': left = Number(numeric(args[0]).toFixed(numeric(args[1]))); break;
          case 'concat': left = args.map((arg) => String(arg ?? '')).join(''); break;
          case 'if': left = args[0] ? args[1] : args[2]; break;
          case 'true': left = true; break;
          case 'false': left = false; break;
          case 'today': left = localToday(); break;
          case 'now': left = new Date().toISOString(); break;
          case 'not': left = !Boolean(args[0]); break;
          case 'pulldata': left = pulls[JSON.stringify(args.map((value) => String(value ?? '')))] ?? ''; break;
          default: throw new Error(`Función XLSForm no compatible: ${token.value}`);
        }
      } else if (token.value === 'true' || token.value === 'false') left = token.value === 'true';
      else left = option[token.value] ?? values[token.value];
    } else throw new Error(`Token inesperado: ${token.value}`);
    while (position < tokens.length) {
      const operator = tokens[position];
      const priority = precedence[operator.value];
      if (operator.kind !== 'operator' || priority === undefined || priority < minimum) break;
      position++;
      const right = parse(priority + 1);
      switch (operator.value) {
        case 'or': left = Boolean(left) || Boolean(right); break;
        case 'and': left = Boolean(left) && Boolean(right); break;
        case '=': left = compare(left, right) === 0; break;
        case '!=': left = compare(left, right) !== 0; break;
        case '>': left = compare(left, right) > 0; break;
        case '<': left = compare(left, right) < 0; break;
        case '>=': left = compare(left, right) >= 0; break;
        case '<=': left = compare(left, right) <= 0; break;
        case '+': left = numeric(left) + numeric(right); break;
        case '-': left = numeric(left) - numeric(right); break;
        case '*': left = numeric(left) * numeric(right); break;
        case '/': left = numeric(right) === 0 ? null : numeric(left) / numeric(right); break;
      }
    }
    return left;
  }
  const value = parse();
  if (position !== tokens.length) throw new Error('Expresión XLSForm incompleta o no compatible');
  return value;
}
