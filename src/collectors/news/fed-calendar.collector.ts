/**
 * Fed 官员讲话日程 + 财经日历采集器 (T-143 / T-144)
 * 来源: federalreserve.gov / investing.com
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { INewsItem } from '../../types';
import dayjs from 'dayjs';

export interface EconomicCalendarEvent {
  date: string;
  time?: string;
  event: string;
  country: string;
  importance: 'high' | 'medium' | 'low';
  previous?: string;
  forecast?: string;
  actual?: string;
}

/** 采集 Fed 官员讲话日程 */
export async function fetchFedCalendar(): Promise<INewsItem[]> {
  return withRetry(
    async () => {
      const res = await axios.get('https://www.federalreserve.gov/json/speech.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 12000,
      });

      const speeches = res.data as Array<{
        title?: string;
        speaker?: string;
        date?: string;
        url?: string;
      }>;

      const cutoff = dayjs().subtract(7, 'day').valueOf();

      return speeches
        .filter(s => s.date && dayjs(s.date).valueOf() > cutoff)
        .map(s => ({
          source: 'fed-calendar',
          timestamp: dayjs(s.date!).valueOf(),
          title: `[Fed] ${s.speaker}: ${s.title}`,
          url: s.url ? `https://www.federalreserve.gov${s.url}` : undefined,
          category: 'fed' as const,
        } satisfies INewsItem));
    },
    'Fed-Calendar',
    { maxAttempts: 2, baseDelayMs: 3000 }
  );
}

/** 采集高影响财经日历事件 */
export async function fetchEconomicCalendar(): Promise<EconomicCalendarEvent[]> {
  return withRetry(
    async () => {
      const res = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
        headers: { 'User-Agent': 'Mozilla/5.0 GoldSentinel/0.1' },
        timeout: 12000,
      });

      const events = res.data as Array<{
        title?: string;
        country?: string;
        date?: string;
        time?: string;
        impact?: string;
        previous?: string;
        forecast?: string;
        actual?: string;
      }>;

      return events
        .filter(e => e.impact === 'High' || e.impact === 'Medium')
        .map(e => ({
          date: e.date ? dayjs(e.date).format('YYYY-MM-DD') : '',
          time: e.time,
          event: e.title ?? '',
          country: e.country ?? '',
          importance: (e.impact?.toLowerCase() as 'high' | 'medium') ?? 'medium',
          previous: e.previous,
          forecast: e.forecast,
          actual: e.actual,
        }));
    },
    'Economic-Calendar',
    { maxAttempts: 2, baseDelayMs: 3000 }
  );
}
