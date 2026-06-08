// src/lib/agreementValidators.test.ts

import { describe, it, expect } from 'vitest';
import {
  validateAssetsInScope,
  validateEligibleCollateral,
  validateLtvPct,
  validateMarginCallLtv,
  validatePositiveInt,
  validateDayCountBasis,
} from './agreementValidators';

describe('validateAssetsInScope', () => {
  it('rejects empty string', () => {
    expect(validateAssetsInScope('')).not.toBeNull();
  });

  it('rejects all-whitespace comma list', () => {
    expect(validateAssetsInScope('  ,  ,  ')).not.toBeNull();
  });

  it('accepts valid comma-separated values', () => {
    expect(validateAssetsInScope('BTC, ETH')).toBeNull();
  });

  it('accepts single value', () => {
    expect(validateAssetsInScope('BTC')).toBeNull();
  });
});

describe('validateEligibleCollateral', () => {
  it('rejects empty string', () => {
    expect(validateEligibleCollateral('')).not.toBeNull();
  });

  it('rejects all-whitespace comma list', () => {
    expect(validateEligibleCollateral(' , , ')).not.toBeNull();
  });

  it('accepts valid comma-separated values', () => {
    expect(validateEligibleCollateral('USDC, USDT')).toBeNull();
  });
});

describe('validateLtvPct', () => {
  it('accepts 0.0001', () => {
    expect(validateLtvPct('0.0001', 'Initial LTV %')).toBeNull();
  });

  it('rejects 0', () => {
    expect(validateLtvPct('0', 'Initial LTV %')).not.toBeNull();
  });

  it('rejects 100', () => {
    expect(validateLtvPct('100', 'Initial LTV %')).not.toBeNull();
  });

  it('accepts 99.9999', () => {
    expect(validateLtvPct('99.9999', 'Initial LTV %')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateLtvPct('', 'Initial LTV %')).not.toBeNull();
  });

  it('rejects non-numeric', () => {
    expect(validateLtvPct('abc', 'Initial LTV %')).not.toBeNull();
  });
});

describe('validateMarginCallLtv', () => {
  it('rejects equal values', () => {
    expect(validateMarginCallLtv('65', '65')).not.toBeNull();
  });

  it('rejects margin < initial', () => {
    expect(validateMarginCallLtv('60', '65')).not.toBeNull();
  });

  it('accepts margin > initial', () => {
    expect(validateMarginCallLtv('80', '65')).toBeNull();
  });

  it('returns null when either value is non-numeric (deferred to individual validators)', () => {
    expect(validateMarginCallLtv('abc', '65')).toBeNull();
    expect(validateMarginCallLtv('80', 'abc')).toBeNull();
  });
});

describe('validatePositiveInt', () => {
  it('rejects 0 when min=1', () => {
    expect(validatePositiveInt('0', 'Recall Notice (days)', 1)).not.toBeNull();
  });

  it('accepts 1 when min=1', () => {
    expect(validatePositiveInt('1', 'Recall Notice (days)', 1)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validatePositiveInt('', 'Recall Notice (days)', 1)).not.toBeNull();
  });

  it('rejects non-integer', () => {
    expect(validatePositiveInt('1.5', 'Recall Notice (days)', 1)).not.toBeNull();
  });

  it('rejects value exceeding max', () => {
    expect(validatePositiveInt('10001', 'Agent Fee (bps)', 0, 10000)).not.toBeNull();
  });

  it('accepts 0 when min=0', () => {
    expect(validatePositiveInt('0', 'Agent Fee (bps)', 0, 10000)).toBeNull();
  });

  it('accepts 10000 when max=10000', () => {
    expect(validatePositiveInt('10000', 'Agent Fee (bps)', 0, 10000)).toBeNull();
  });
});

describe('validateDayCountBasis', () => {
  it('accepts actual_360', () => {
    expect(validateDayCountBasis('actual_360')).toBeNull();
  });

  it('accepts actual_365', () => {
    expect(validateDayCountBasis('actual_365')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateDayCountBasis('')).not.toBeNull();
  });

  it('rejects unknown value', () => {
    expect(validateDayCountBasis('actual_30')).not.toBeNull();
  });
});
