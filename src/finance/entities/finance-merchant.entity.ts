import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Нормализованный плательщик/получатель → категория. Порт `merchants` из schema.sql.
 * `normName` — ключ дедупликации мерчантов (см. merchant-normalize.ts).
 */
@Entity('fin_merchant')
export class FinanceMerchant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  normName: string;

  @Column({ type: 'varchar' })
  display: string;

  @Index()
  @Column({ type: 'int', nullable: true })
  categoryId: number | null;
}
