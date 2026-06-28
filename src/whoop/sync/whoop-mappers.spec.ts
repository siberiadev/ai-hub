import { mapCycle, mapRecovery, mapSleep, mapWorkout } from './whoop-mappers';
import type {
  WhoopCycleDto,
  WhoopRecoveryDto,
  WhoopSleepDto,
  WhoopWorkoutDto,
} from '../api/whoop-api.types';

describe('whoop-mappers', () => {
  it('mapWorkout раскладывает score и zone_durations', () => {
    const dto: WhoopWorkoutDto = {
      id: 'w-1',
      user_id: 42,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      start: '2024-01-01T10:00:00.000Z',
      end: '2024-01-01T11:00:00.000Z',
      timezone_offset: '-05:00',
      sport_id: 1,
      sport_name: 'running',
      score_state: 'SCORED',
      score: {
        strain: 8.2,
        average_heart_rate: 123,
        max_heart_rate: 146,
        kilojoule: 1864.4,
        zone_durations: { zone_zero_milli: 5, zone_five_milli: 50 },
      },
    };
    const e = mapWorkout(dto);
    expect(e.id).toBe('w-1');
    expect(e.whoopUserId).toBe('42'); // bigint → строка
    expect(e.strain).toBe(8.2);
    expect(e.maxHeartRate).toBe(146);
    expect(e.zoneZeroMilli).toBe(5);
    expect(e.zoneFiveMilli).toBe(50);
    expect(e.zoneOneMilli).toBeNull(); // отсутствующее → null
    expect(e.start).toEqual(new Date('2024-01-01T10:00:00.000Z'));
    expect(e.whoopUpdatedAt).toEqual(new Date('2024-01-02T00:00:00.000Z'));
    expect(e.raw).toBe(dto);
  });

  it('mapSleep раскладывает stage_summary и sleep_needed', () => {
    const dto: WhoopSleepDto = {
      id: 's-1',
      user_id: 42,
      cycle_id: 999,
      nap: false,
      start: '2024-01-01T00:00:00.000Z',
      score_state: 'SCORED',
      score: {
        respiratory_rate: 16.1,
        sleep_performance_percentage: 98,
        stage_summary: { total_in_bed_time_milli: 1000, total_rem_sleep_time_milli: 300 },
        sleep_needed: { baseline_milli: 28800000 },
      },
    };
    const e = mapSleep(dto);
    expect(e.cycleId).toBe('999');
    expect(e.respiratoryRate).toBe(16.1);
    expect(e.totalInBedTimeMilli).toBe(1000);
    expect(e.totalRemSleepTimeMilli).toBe(300);
    expect(e.baselineMilli).toBe(28800000);
    expect(e.nap).toBe(false);
  });

  it('mapRecovery (PK sleep_id) и mapCycle (PK bigint строкой)', () => {
    const rec: WhoopRecoveryDto = {
      cycle_id: 999,
      sleep_id: 's-1',
      user_id: 42,
      score_state: 'SCORED',
      score: { recovery_score: 44, hrv_rmssd_milli: 31.8, resting_heart_rate: 64 },
    };
    const r = mapRecovery(rec);
    expect(r.sleepId).toBe('s-1');
    expect(r.cycleId).toBe('999');
    expect(r.recoveryScore).toBe(44);
    expect(r.hrvRmssdMilli).toBe(31.8);

    const cyc: WhoopCycleDto = {
      id: 999,
      user_id: 42,
      start: '2024-01-01T00:00:00.000Z',
      score_state: 'SCORED',
      score: { strain: 12.3, average_heart_rate: 70 },
    };
    const c = mapCycle(cyc);
    expect(c.id).toBe('999');
    expect(c.strain).toBe(12.3);
    expect(c.averageHeartRate).toBe(70);
  });
});
