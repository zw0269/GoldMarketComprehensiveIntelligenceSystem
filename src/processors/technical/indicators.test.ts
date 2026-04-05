/**
 * T-801: 技术指标计算正确性单元测试
 */
import {
  calculateMovingAverages,
  calculateMACD,
  calculateRSI,
  calculateBollingerBands,
  calculateFibonacciLevels,
  findSupportResistanceLevels,
  aggregateOHLCV,
} from './indicators';

// 生成测试数据（模拟金价序列）
function generatePrices(count: number, base = 3000, volatility = 50): number[] {
  const prices: number[] = [base];
  for (let i = 1; i < count; i++) {
    prices.push(prices[i - 1] + (Math.random() - 0.5) * volatility);
  }
  return prices;
}

describe('Moving Averages', () => {
  it('returns null for insufficient data', () => {
    const result = calculateMovingAverages([1, 2, 3]);
    expect(result['MA5']).toBeNull();
    expect(result['MA20']).toBeNull();
  });

  it('calculates MA5 correctly', () => {
    const prices = [100, 200, 300, 400, 500, 600];
    const result = calculateMovingAverages(prices);
    // MA5 of last 5 values: (200+300+400+500+600)/5 = 400
    expect(result['MA5']).toBeCloseTo(400, 1);
  });

  it('returns values for sufficient data', () => {
    const prices = generatePrices(30, 3000);
    const result = calculateMovingAverages(prices);
    expect(result['MA5']).not.toBeNull();
    expect(result['MA20']).not.toBeNull();
    expect(result['MA250']).toBeNull(); // insufficient
  });
});

describe('MACD', () => {
  it('returns null for < 26 data points', () => {
    expect(calculateMACD([1, 2, 3])).toBeNull();
  });

  it('calculates MACD with sufficient data', () => {
    const prices = generatePrices(50, 3000, 30);
    const result = calculateMACD(prices);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
  });
});

describe('RSI', () => {
  it('returns null for insufficient data', () => {
    expect(calculateRSI([1, 2, 3])).toBeNull();
  });

  it('RSI is between 0 and 100', () => {
    const prices = generatePrices(30, 3000, 20);
    const rsi = calculateRSI(prices);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });
});

describe('Bollinger Bands', () => {
  it('upper >= middle >= lower', () => {
    const prices = generatePrices(30, 3000, 10);
    const bb = calculateBollingerBands(prices);
    expect(bb).not.toBeNull();
    expect(bb!.upper).toBeGreaterThanOrEqual(bb!.middle);
    expect(bb!.middle).toBeGreaterThanOrEqual(bb!.lower);
  });
});

describe('Fibonacci Levels', () => {
  it('0% level equals high, 100% level equals low', () => {
    const fib = calculateFibonacciLevels(4000, 3000);
    expect(fib['0.0']).toBe(4000);
    expect(fib['100.0']).toBe(3000);
    expect(fib['50.0']).toBe(3500);
    expect(fib['61.8']).toBeCloseTo(3382, 0);
  });
});

describe('Support/Resistance Levels', () => {
  it('returns arrays', () => {
    const prices = generatePrices(50, 3000, 30);
    const { supports, resistances } = findSupportResistanceLevels(prices);
    expect(Array.isArray(supports)).toBe(true);
    expect(Array.isArray(resistances)).toBe(true);
  });
});

describe('OHLCV Aggregation', () => {
  it('aggregates 1min bars to 5min', () => {
    const minuteBars = Array.from({ length: 30 }, (_, i) => ({
      ts: Date.now() - (29 - i) * 60000,
      xau_usd: 3000 + i,
    }));
    const bars = aggregateOHLCV(minuteBars, 5);
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toHaveProperty('open');
    expect(bars[0]).toHaveProperty('high');
    expect(bars[0]).toHaveProperty('low');
    expect(bars[0]).toHaveProperty('close');
  });
});
