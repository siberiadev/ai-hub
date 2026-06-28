import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * OAuth-аккаунт WHOOP: токены (зашифрованы AES-256-GCM) + маппинг на whoop_user_id.
 * Одна строка на пользователя WHOOP (single-user, но ключ по user_id — на будущее).
 */
@Entity('whoop_account')
export class WhoopAccount {
  /** WHOOP user id (int64) — в TS строка (bigint). */
  @PrimaryColumn({ type: 'bigint' })
  whoopUserId: string;

  /** Зашифрованный access-токен (blob из whoop-crypto). */
  @Column({ type: 'text' })
  accessTokenEnc: string;

  /** Зашифрованный refresh-токен (есть при scope=offline). */
  @Column({ type: 'text', nullable: true })
  refreshTokenEnc: string | null;

  /** Момент истечения access-токена. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'varchar', nullable: true })
  scopes: string | null;

  @Column({ type: 'varchar', nullable: true })
  tokenType: string | null;

  // --- профиль (из /v2/user/profile/basic, удобно для одного юзера) ---
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastName: string | null;

  /** Когда аккаунт впервые подключили. */
  @Column({ type: 'timestamptz' })
  connectedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
