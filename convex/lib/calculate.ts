import { calculateInputSchema, type CalculateInput } from './validation'

type CalculationError = { operation: string; result: null; error: { code: string; message: string } }
type CalculationSuccess = { operation: string; result: number; [key: string]: unknown }
export type CalculateResult = CalculationError | CalculationSuccess

const KG_TO_LBS = 2.2046226218
const MILES_TO_KM = 1.609344
const standardPlates = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lbs: [45, 35, 25, 10, 5, 2.5],
} as const

function error(operation: string, code: string, message: string): CalculationError {
  return { operation, result: null, error: { code, message } }
}

function normalizeNumber(value: number): number {
  return Number(value.toFixed(10))
}

/**
 * A closed arithmetic grammar for the expression fallback. It deliberately
 * contains no variable lookup, member access, assignment, or JS evaluation.
 */
class ArithmeticParser {
  private index = 0
  private readonly source: string

  public constructor(source: string) { this.source = source }

  public parse(): number {
    const result = this.parseExpression()
    this.skipWhitespace()
    if (this.index !== this.source.length) throw new Error('Unexpected input in expression.')
    if (!Number.isFinite(result)) throw new Error('Expression result is not a finite number.')
    return result
  }

  private parseExpression(): number {
    let value = this.parseTerm()
    while (true) {
      if (this.consume('+')) value += this.parseTerm()
      else if (this.consume('-')) value -= this.parseTerm()
      else return value
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary()
    while (true) {
      if (this.consume('*')) value *= this.parseUnary()
      else if (this.consume('/')) {
        const divisor = this.parseUnary()
        if (divisor === 0) throw new Error('Division by zero is not allowed.')
        value /= divisor
      } else if (this.consume('%')) {
        const divisor = this.parseUnary()
        if (divisor === 0) throw new Error('Modulo by zero is not allowed.')
        value %= divisor
      } else return value
    }
  }

  private parseUnary(): number {
    if (this.consume('+')) return this.parseUnary()
    if (this.consume('-')) return -this.parseUnary()
    return this.parsePrimary()
  }

  private parsePrimary(): number {
    if (this.consume('(')) {
      const value = this.parseExpression()
      if (!this.consume(')')) throw new Error('Expected closing parenthesis.')
      return value
    }
    const number = this.readNumber()
    if (number !== null) return number
    const name = this.readIdentifier()
    if (name === null) throw new Error('Expected a number, parenthesis, or allowed function.')
    if (!this.consume('(')) throw new Error(`Unknown identifier: ${name}.`)
    const args = this.readArguments()
    return this.callFunction(name, args)
  }

  private readArguments(): number[] {
    const args: number[] = []
    if (this.consume(')')) return args
    do { args.push(this.parseExpression()) } while (this.consume(','))
    if (!this.consume(')')) throw new Error('Expected closing parenthesis after function arguments.')
    return args
  }

  private callFunction(name: string, args: number[]): number {
    const one = (fn: (value: number) => number): number => {
      if (args.length !== 1) throw new Error(`${name} requires exactly one argument.`)
      return fn(args[0]!)
    }
    switch (name) {
      case 'sqrt': return one(Math.sqrt)
      case 'round': return one(Math.round)
      case 'floor': return one(Math.floor)
      case 'ceil': return one(Math.ceil)
      case 'abs': return one(Math.abs)
      case 'min': if (args.length === 0) throw new Error('min requires at least one argument.'); return Math.min(...args)
      case 'max': if (args.length === 0) throw new Error('max requires at least one argument.'); return Math.max(...args)
      case 'pow': if (args.length !== 2) throw new Error('pow requires exactly two arguments.'); return Math.pow(args[0]!, args[1]!)
      default: throw new Error(`Function ${name} is not allowed.`)
    }
  }

  private readNumber(): number | null {
    this.skipWhitespace()
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index))
    if (match === null) return null
    this.index += match[0].length
    return Number(match[0])
  }

  private readIdentifier(): string | null {
    this.skipWhitespace()
    const match = /^[A-Za-z]+/.exec(this.source.slice(this.index))
    if (match === null) return null
    this.index += match[0].length
    return match[0]
  }

  private consume(token: string): boolean {
    this.skipWhitespace()
    if (!this.source.startsWith(token, this.index)) return false
    this.index += token.length
    return true
  }

  private skipWhitespace(): void { while (/\s/.test(this.source[this.index] ?? '')) this.index += 1 }
}

function calculate(input: CalculateInput): CalculateResult {
  switch (input.operation) {
    case 'oneRepMax': {
      if (input.formula === 'brzycki' && input.reps >= 37) return error(input.operation, 'OUT_OF_DOMAIN', 'Brzycki is undefined for reps greater than or equal to 37.')
      const result = input.formula === 'epley'
        ? input.weight * (1 + input.reps / 30)
        : input.weight * (36 / (37 - input.reps))
      return { operation: input.operation, result: normalizeNumber(result), formula: input.formula, weightUnit: input.weightUnit }
    }
    case 'percentOf1RM': {
      const unroundedResult = input.oneRepMax * input.percent / 100
      return { operation: input.operation, result: normalizeNumber(Math.round(unroundedResult * 2) / 2), oneRepMax: input.oneRepMax, percent: input.percent }
    }
    case 'convertUnit': {
      const weightUnits = new Set(['kg', 'lbs'])
      if (weightUnits.has(input.from) !== weightUnits.has(input.to)) return error(input.operation, 'CROSS_FAMILY_CONVERSION', `Cannot convert ${input.from} to ${input.to}; weight and distance units cannot be mixed.`)
      let result = input.value
      if (input.from === 'kg' && input.to === 'lbs') result *= KG_TO_LBS
      if (input.from === 'lbs' && input.to === 'kg') result /= KG_TO_LBS
      if (input.from === 'miles' && input.to === 'km') result *= MILES_TO_KM
      if (input.from === 'km' && input.to === 'miles') result /= MILES_TO_KM
      return { operation: input.operation, result: normalizeNumber(result), from: input.from, to: input.to }
    }
    case 'plateMath': {
      const plates = [...(input.availablePlates ?? standardPlates[input.weightUnit])].sort((left, right) => right - left)
      let remainder = Math.max(0, input.targetWeight - input.barWeight) / 2
      const platesPerSide: Array<{ plate: number; count: number }> = []
      for (const plate of plates) {
        const count = Math.floor((remainder + 1e-9) / plate)
        if (count > 0) { platesPerSide.push({ plate, count }); remainder -= count * plate }
      }
      const loadedPerSide = platesPerSide.reduce((total, entry) => total + entry.plate * entry.count, 0)
      const actualTotal = normalizeNumber(input.barWeight + loadedPerSide * 2)
      return { operation: input.operation, result: actualTotal, targetWeight: input.targetWeight, barWeight: input.barWeight, weightUnit: input.weightUnit, platesPerSide, actualTotal, exact: Math.abs(actualTotal - input.targetWeight) < 1e-8 }
    }
    case 'volumeTotal': {
      return { operation: input.operation, result: normalizeNumber(input.sets.reduce((total, set) => total + set.reps * set.weight, 0)), setCount: input.sets.length }
    }
    case 'paceConvert': {
      if (input.distance <= 0) return error(input.operation, 'OUT_OF_DOMAIN', 'Distance must be greater than zero to calculate pace.')
      if (input.duration < 0) return error(input.operation, 'OUT_OF_DOMAIN', 'Duration cannot be negative.')
      const result = input.duration / input.distance
      const roundedSeconds = Math.round(result)
      return { operation: input.operation, result: normalizeNumber(result), secondsPerUnit: normalizeNumber(result), formatted: `${Math.floor(roundedSeconds / 60)}:${String(roundedSeconds % 60).padStart(2, '0')} per ${input.distanceUnit}`, distanceUnit: input.distanceUnit }
    }
    case 'expression': {
      try { return { operation: input.operation, result: normalizeNumber(new ArithmeticParser(input.expression).parse()) } }
      catch (caught: unknown) { return error(input.operation, 'INVALID_EXPRESSION', caught instanceof Error ? caught.message : 'Expression could not be evaluated.') }
    }
  }
}

export function executeCalculate(input: unknown): CalculateResult {
  const parsed = calculateInputSchema.safeParse(input)
  if (!parsed.success) return error(typeof input === 'object' && input !== null && 'operation' in input && typeof input.operation === 'string' ? input.operation : 'unknown', 'VALIDATION_ERROR', parsed.error.issues.map((issue) => issue.message).join('; '))
  return calculate(parsed.data)
}
