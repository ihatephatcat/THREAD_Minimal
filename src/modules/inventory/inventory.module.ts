import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryMovement, InventoryStock } from '../../database/entities';
import { InventoryService } from './inventory.service';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryStock, InventoryMovement])],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
