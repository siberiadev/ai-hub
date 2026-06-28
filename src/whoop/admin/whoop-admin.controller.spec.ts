import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { WhoopAdminController } from './whoop-admin.controller';
import type { WhoopAdminService } from './whoop-admin.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
function make(secret: string | undefined, startBackfill = jest.fn()) {
  const admin = { startBackfill } as unknown as WhoopAdminService;
  const config = {
    get: jest.fn(() => secret),
  } as unknown as ConfigService;
  return { ctrl: new WhoopAdminController(admin, config), startBackfill };
}

describe('WhoopAdminController', () => {
  it('неверный key → 404, startBackfill не зовётся', () => {
    const { ctrl, startBackfill } = make('right');
    expect(() => ctrl.backfill('wrong')).toThrow(NotFoundException);
    expect(startBackfill).not.toHaveBeenCalled();
  });

  it('пустой секрет в конфиге → 404 даже при пустом key', () => {
    const { ctrl } = make(undefined);
    expect(() => ctrl.backfill(undefined)).toThrow(NotFoundException);
  });

  it('верный key → делегирует since в startBackfill', () => {
    const startBackfill = jest.fn(() => ({
      started: true,
      since: '2024-01-01T00:00:00.000Z',
    }));
    const { ctrl } = make('right', startBackfill);
    const res = ctrl.backfill('right', '2024-01-01');
    expect(startBackfill).toHaveBeenCalledWith('2024-01-01');
    expect(res).toEqual({ started: true, since: '2024-01-01T00:00:00.000Z' });
  });
});
