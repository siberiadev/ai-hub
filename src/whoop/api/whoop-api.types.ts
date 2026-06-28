import type { ScoreState } from '../whoop.types';

/** Конверт пагинации коллекций WHOOP v2. */
export interface WhoopPage<T> {
  records: T[];
  next_token?: string | null;
}

interface WhoopBase {
  user_id: number;
  created_at?: string;
  updated_at?: string;
  start?: string;
  end?: string | null;
  timezone_offset?: string;
  score_state: ScoreState;
}

export interface WhoopWorkoutDto extends WhoopBase {
  id: string;
  v1_id?: number;
  sport_id?: number;
  sport_name?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
    percent_recorded?: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_durations?: {
      zone_zero_milli?: number;
      zone_one_milli?: number;
      zone_two_milli?: number;
      zone_three_milli?: number;
      zone_four_milli?: number;
      zone_five_milli?: number;
    };
  };
}

export interface WhoopSleepDto extends WhoopBase {
  id: string;
  cycle_id?: number;
  v1_id?: number;
  nap?: boolean;
  score?: {
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      total_no_data_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
      sleep_cycle_count?: number;
      disturbance_count?: number;
    };
    sleep_needed?: {
      baseline_milli?: number;
      need_from_sleep_debt_milli?: number;
      need_from_recent_strain_milli?: number;
      need_from_recent_nap_milli?: number;
    };
  };
}

export interface WhoopRecoveryDto {
  cycle_id: number;
  sleep_id: string;
  user_id: number;
  created_at?: string;
  updated_at?: string;
  score_state: ScoreState;
  score?: {
    user_calibrating?: boolean;
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

export interface WhoopCycleDto extends WhoopBase {
  id: number;
  score?: {
    strain?: number;
    kilojoule?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
  };
}
