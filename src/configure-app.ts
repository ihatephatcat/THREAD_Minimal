import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/http/exception.filter';
import { requestContext } from './common/http/request-context';
import { SuccessInterceptor } from './common/http/success.interceptor';

export function configureApp(app: INestApplication): void {
  app.use(requestContext);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new SuccessInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('Minimal THREAD API')
    .setDescription('Starter endpoints for the CSC4161 e-commerce project.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swagger), {
    useGlobalPrefix: true,
  });
}
