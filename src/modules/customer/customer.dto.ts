import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Sam Rahman' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  name!: string;
}

export class CreateAddressDto {
  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @Length(1, 100)
  recipientName!: string;

  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @Length(1, 30)
  phone!: string;

  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @Length(1, 200)
  line1!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @ValidateIf((_input, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(/\S/)
  @Length(1, 200)
  line2?: string | null;

  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @Length(1, 100)
  city!: string;

  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @Length(1, 20)
  postalCode!: string;

  @ApiProperty({ example: 'BD' })
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto, { skipNullProperties: false }) {}

export class SetCartItemDto {
  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;
}

export class CheckoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  addressId!: string;
}

