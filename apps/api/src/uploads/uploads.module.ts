import { Global, Module } from '@nestjs/common'
import { S3Service } from './s3.service'
import { UploadsService } from './uploads.service'
import { UploadsController } from './uploads.controller'

/**
 * Global so the agents module can inject S3Service without importing this
 * whole module — UploadsService stays scoped to its own controller.
 */
@Global()
@Module({
  providers: [S3Service, UploadsService],
  controllers: [UploadsController],
  exports: [S3Service],
})
export class UploadsModule {}
