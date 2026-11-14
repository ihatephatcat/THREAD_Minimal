import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Address, Cart, CartItem, Order, OrderItem, User } from '../../database/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Address, Cart, CartItem, Order, OrderItem]),
    StaffModule,
    InventoryModule,
  ],
})
export class CustomerModule {}
