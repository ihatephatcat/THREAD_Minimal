import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/http/openapi';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { UserResponseDto } from '../auth/auth.dto';
import { Role, type AuthenticatedUser } from '../auth/role';

@ApiTags('Admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token required' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@Roles(Role.Admin)
@Controller('admin')
export class AdminController {
  @Get('access')
  @ApiDataResponse(UserResponseDto)
  checkAccess(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
