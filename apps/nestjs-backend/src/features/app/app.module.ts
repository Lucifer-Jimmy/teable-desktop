import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [PrismaModule],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppService],
})
export class AppFeatureModule {}
