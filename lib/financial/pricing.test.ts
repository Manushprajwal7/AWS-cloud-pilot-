import { describe, expect, it } from 'vitest'
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR, priceConfiguration, toCostBreakdown } from './pricing'

describe('lib/financial/pricing', () => {
  describe('toCostBreakdown', () => {
    it('derives daily, monthly, and annual from hourly using the fixed hour constants', () => {
      const breakdown = toCostBreakdown(0.1)
      expect(breakdown.dailyUsd).toBeCloseTo(0.1 * HOURS_PER_DAY, 2)
      expect(breakdown.monthlyUsd).toBeCloseTo(0.1 * HOURS_PER_MONTH, 2)
      expect(breakdown.annualUsd).toBeCloseTo(0.1 * HOURS_PER_YEAR, 2)
    })

    it('annual is exactly 12x monthly given the fixed hour conventions', () => {
      const breakdown = toCostBreakdown(0.2)
      expect(breakdown.annualUsd).toBeCloseTo(breakdown.monthlyUsd * 12, 1)
    })

    it('handles zero cost', () => {
      const breakdown = toCostBreakdown(0)
      expect(breakdown).toEqual({ hourlyUsd: 0, dailyUsd: 0, monthlyUsd: 0, annualUsd: 0 })
    })
  })

  describe('priceConfiguration', () => {
    it('prices an EC2 configuration deterministically', () => {
      const breakdown = priceConfiguration('EC2', { instanceType: 'm5.large' }, { requestsPerMinute: 0 })
      expect(breakdown.hourlyUsd).toBeGreaterThan(0)
      expect(breakdown.monthlyUsd).toBeCloseTo(breakdown.hourlyUsd * HOURS_PER_MONTH, 2)
    })

    it('a larger instance type prices higher than a smaller one', () => {
      const small = priceConfiguration('EC2', { instanceType: 't3.small' }, { requestsPerMinute: 0 })
      const large = priceConfiguration('EC2', { instanceType: 'm5.xlarge' }, { requestsPerMinute: 0 })
      expect(large.hourlyUsd).toBeGreaterThan(small.hourlyUsd)
    })
  })
})
