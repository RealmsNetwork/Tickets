export function calculate(expression) {
  const source = String(expression ?? '').trim();
  if (!source || source.length > 120) throw new Error('Enter an expression up to 120 characters long.');
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([()+\-*/%^]))/y;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unsupported character near “${source.slice(offset, offset + 12)}”.`);
    tokens.push(match[1] !== undefined ? { type: 'number', value: Number(match[1]) } : { type: 'operator', value: match[2] });
    offset = pattern.lastIndex;
  }
  let index = 0;
  const peek = () => tokens[index];
  const consume = (value) => {
    if (peek()?.value !== value) throw new Error(`Expected “${value}”.`);
    index++;
  };
  const primary = () => {
    const token = peek();
    if (!token) throw new Error('Expression ended unexpectedly.');
    if (token.type === 'number') { index++; return token.value; }
    if (token.value === '(') {
      index++;
      const value = additive();
      consume(')');
      return value;
    }
    throw new Error(`Unexpected token “${token.value}”.`);
  };
  const power = () => {
    const left = primary();
    if (peek()?.value === '^') {
      index++;
      return left ** unary();
    }
    return left;
  };
  const unary = () => {
    if (peek()?.value === '+') { index++; return unary(); }
    if (peek()?.value === '-') { index++; return -unary(); }
    return power();
  };
  const multiplicative = () => {
    let value = unary();
    while (['*', '/', '%'].includes(peek()?.value)) {
      const operator = tokens[index++].value;
      const right = unary();
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('Division by zero is not allowed.');
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  };
  function additive() {
    let value = multiplicative();
    while (['+', '-'].includes(peek()?.value)) {
      const operator = tokens[index++].value;
      const right = multiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = additive();
  if (index !== tokens.length) throw new Error(`Unexpected token “${tokens[index].value}”.`);
  if (!Number.isFinite(result)) throw new Error('Result is outside the supported numeric range.');
  return Number.parseFloat(result.toPrecision(12));
}
