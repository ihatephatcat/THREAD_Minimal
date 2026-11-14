import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InventoryMovement, InventoryStock } from '../../database/entities';
import { MovementType } from '../../database/entities/inventory.entity';

@Injectable()
export class InventoryService {
  /**
   * Call within checkout's transaction and visit variants in ascending ID order.
   * The update and movement are committed or rolled back by the caller.
   */
  async deductStock(
    manager: EntityManager,
    variantId: string,
    quantity: number,
    actorId: string,
    orderId: string,
  ): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error('Stock deduction requires an active transaction');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2_147_483_647) {
      throw new BadRequestException('Stock deduction quantity must be a positive integer');
    }

    const update = await manager.getRepository(InventoryStock).createQueryBuilder()
      .update()
      .set({ quantity: () => '"quantity" - :quantity' })
      .where('"variantId" = :variantId AND "quantity" >= :quantity', { variantId, quantity })
      .execute();

    if (update.affected !== 1) {
      throw new ConflictException('Insufficient stock');
    }
    await manager.insert(InventoryMovement, {
      variantId,
      actorId,
      type: MovementType.Sale,
      delta: -quantity,
      reason: `Order ${orderId}`,
    });
  }
}
