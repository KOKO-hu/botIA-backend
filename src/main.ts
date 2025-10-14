import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true, // reflète l'origine de la requête (autorise toutes les origines)
    credentials: true,
  });
  await app.listen(3004);
}
bootstrap();
