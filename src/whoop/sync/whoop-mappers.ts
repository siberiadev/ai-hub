import { WhoopCycle } from '../entities/whoop-cycle.entity';
import { WhoopRecovery } from '../entities/whoop-recovery.entity';
import { WhoopSleep } from '../entities/whoop-sleep.entity';
import { WhoopWorkout } from '../entities/whoop-workout.entity';
import type {
  WhoopCycleDto,
  WhoopRecoveryDto,
  WhoopSleepDto,
  WhoopWorkoutDto,
} from '../api/whoop-api.types';

/** Чистые мапперы ответов WHOOP API v2 → сущности (полная нормализация Фазы 2). */

const date = (s?: string | null): Date | null => (s ? new Date(s) : null);

export function mapWorkout(dto: WhoopWorkoutDto): WhoopWorkout {
  const e = new WhoopWorkout();
  e.id = dto.id;
  e.whoopUserId = String(dto.user_id);
  e.v1Id = dto.v1_id ?? null;
  e.start = new Date(dto.start as string);
  e.end = date(dto.end);
  e.timezoneOffset = dto.timezone_offset ?? null;
  e.sportId = dto.sport_id ?? null;
  e.sportName = dto.sport_name ?? null;
  e.scoreState = dto.score_state;
  const s = dto.score;
  e.strain = s?.strain ?? null;
  e.averageHeartRate = s?.average_heart_rate ?? null;
  e.maxHeartRate = s?.max_heart_rate ?? null;
  e.kilojoule = s?.kilojoule ?? null;
  e.percentRecorded = s?.percent_recorded ?? null;
  e.distanceMeter = s?.distance_meter ?? null;
  e.altitudeGainMeter = s?.altitude_gain_meter ?? null;
  e.altitudeChangeMeter = s?.altitude_change_meter ?? null;
  const z = s?.zone_durations;
  e.zoneZeroMilli = z?.zone_zero_milli ?? null;
  e.zoneOneMilli = z?.zone_one_milli ?? null;
  e.zoneTwoMilli = z?.zone_two_milli ?? null;
  e.zoneThreeMilli = z?.zone_three_milli ?? null;
  e.zoneFourMilli = z?.zone_four_milli ?? null;
  e.zoneFiveMilli = z?.zone_five_milli ?? null;
  e.whoopCreatedAt = date(dto.created_at);
  e.whoopUpdatedAt = date(dto.updated_at);
  e.raw = dto;
  e.deletedAt = null;
  return e;
}

export function mapSleep(dto: WhoopSleepDto): WhoopSleep {
  const e = new WhoopSleep();
  e.id = dto.id;
  e.whoopUserId = String(dto.user_id);
  e.cycleId = dto.cycle_id != null ? String(dto.cycle_id) : null;
  e.v1Id = dto.v1_id ?? null;
  e.nap = dto.nap ?? false;
  e.start = new Date(dto.start as string);
  e.end = date(dto.end);
  e.timezoneOffset = dto.timezone_offset ?? null;
  e.scoreState = dto.score_state;
  const s = dto.score;
  e.respiratoryRate = s?.respiratory_rate ?? null;
  e.sleepPerformancePercentage = s?.sleep_performance_percentage ?? null;
  e.sleepConsistencyPercentage = s?.sleep_consistency_percentage ?? null;
  e.sleepEfficiencyPercentage = s?.sleep_efficiency_percentage ?? null;
  const ss = s?.stage_summary;
  e.totalInBedTimeMilli = ss?.total_in_bed_time_milli ?? null;
  e.totalAwakeTimeMilli = ss?.total_awake_time_milli ?? null;
  e.totalNoDataTimeMilli = ss?.total_no_data_time_milli ?? null;
  e.totalLightSleepTimeMilli = ss?.total_light_sleep_time_milli ?? null;
  e.totalSlowWaveSleepTimeMilli = ss?.total_slow_wave_sleep_time_milli ?? null;
  e.totalRemSleepTimeMilli = ss?.total_rem_sleep_time_milli ?? null;
  e.sleepCycleCount = ss?.sleep_cycle_count ?? null;
  e.disturbanceCount = ss?.disturbance_count ?? null;
  const sn = s?.sleep_needed;
  e.baselineMilli = sn?.baseline_milli ?? null;
  e.needFromSleepDebtMilli = sn?.need_from_sleep_debt_milli ?? null;
  e.needFromRecentStrainMilli = sn?.need_from_recent_strain_milli ?? null;
  e.needFromRecentNapMilli = sn?.need_from_recent_nap_milli ?? null;
  e.whoopCreatedAt = date(dto.created_at);
  e.whoopUpdatedAt = date(dto.updated_at);
  e.raw = dto;
  e.deletedAt = null;
  return e;
}

export function mapRecovery(dto: WhoopRecoveryDto): WhoopRecovery {
  const e = new WhoopRecovery();
  e.sleepId = dto.sleep_id;
  e.cycleId = String(dto.cycle_id);
  e.whoopUserId = String(dto.user_id);
  e.scoreState = dto.score_state;
  const s = dto.score;
  e.userCalibrating = s?.user_calibrating ?? null;
  e.recoveryScore = s?.recovery_score ?? null;
  e.restingHeartRate = s?.resting_heart_rate ?? null;
  e.hrvRmssdMilli = s?.hrv_rmssd_milli ?? null;
  e.spo2Percentage = s?.spo2_percentage ?? null;
  e.skinTempCelsius = s?.skin_temp_celsius ?? null;
  e.whoopCreatedAt = date(dto.created_at);
  e.whoopUpdatedAt = date(dto.updated_at);
  e.raw = dto;
  e.deletedAt = null;
  return e;
}

export function mapCycle(dto: WhoopCycleDto): WhoopCycle {
  const e = new WhoopCycle();
  e.id = String(dto.id);
  e.whoopUserId = String(dto.user_id);
  e.start = new Date(dto.start as string);
  e.end = date(dto.end);
  e.timezoneOffset = dto.timezone_offset ?? null;
  e.scoreState = dto.score_state;
  const s = dto.score;
  e.strain = s?.strain ?? null;
  e.kilojoule = s?.kilojoule ?? null;
  e.averageHeartRate = s?.average_heart_rate ?? null;
  e.maxHeartRate = s?.max_heart_rate ?? null;
  e.whoopCreatedAt = date(dto.created_at);
  e.whoopUpdatedAt = date(dto.updated_at);
  e.raw = dto;
  e.deletedAt = null;
  return e;
}
