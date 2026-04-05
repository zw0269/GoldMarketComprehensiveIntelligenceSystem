/**
 * CFTC COT 持仓报告下载器 (T-124)
 * 来源: CFTC 官网 (周五发布上周二数据)
 * 黄金 COMEX CFTC Code: 088691
 */
import axios from 'axios';
import logger from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { ICOTReport } from '../../types';
import dayjs from 'dayjs';

// CFTC 历史数据 CSV
const CFTC_CSV_URL = 'https://www.cftc.gov/files/dea/history/fut_disagg_txt_2024.zip';
// 当年实时数据（txt格式，逗号分隔）
const CFTC_CURRENT_URL =
  'https://www.cftc.gov/dea/newcot/f_disagg.txt';

const GOLD_CFTC_CODE = '088691';

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let inQuote = false;
  let current = '';
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

export async function fetchCFTCCOT(): Promise<ICOTReport | null> {
  return withRetry(
    async () => {
      const res = await axios.get(CFTC_CURRENT_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 30000,
        responseType: 'text',
      });

      const text = res.data as string;
      const lines = text.split('\n');
      const header = parseCSVLine(lines[0]);

      const idx = {
        code: header.indexOf('CFTC_Commodity_Code'),
        date: header.indexOf('Report_Date_as_YYYY-MM-DD'),
        commLong: header.indexOf('Comm_Positions_Long_All'),
        commShort: header.indexOf('Comm_Positions_Short_All'),
        noncommLong: header.indexOf('NonComm_Positions_Long_All'),
        noncommShort: header.indexOf('NonComm_Positions_Short_All'),
      };

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (!cols[idx.code]?.includes(GOLD_CFTC_CODE)) continue;

        const commercialLong = parseInt(cols[idx.commLong] || '0', 10);
        const commercialShort = parseInt(cols[idx.commShort] || '0', 10);
        const noncommLong = parseInt(cols[idx.noncommLong] || '0', 10);
        const noncommShort = parseInt(cols[idx.noncommShort] || '0', 10);

        logger.info('[cftc] parsed COT report', { date: cols[idx.date], noncommLong, noncommShort });

        return {
          date: cols[idx.date] || dayjs().format('YYYY-MM-DD'),
          commercialLong,
          commercialShort,
          noncommLong,
          noncommShort,
          netLong: noncommLong - noncommShort,
        } satisfies ICOTReport;
      }

      throw new Error('CFTC COT: gold entry not found in report');
    },
    'CFTC-COT',
    { maxAttempts: 3, baseDelayMs: 5000 }
  );
}
