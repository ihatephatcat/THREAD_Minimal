import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category, Collection, Product, ProductVariant } from '../../database/entities';
import { CatalogService } from './catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Collection, Product, ProductVariant])],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class StaffModule {}
