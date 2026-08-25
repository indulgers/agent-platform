import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { ConnectorsController, ConnectorCallbacksController } from './connectors.controller'
import { ConnectorsService } from './connectors.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'
import { RemoteMcpService } from './remote-mcp.service'

@Module({
  imports: [PrismaModule],
  controllers: [ConnectorsController, ConnectorCallbacksController],
  providers: [
    ConnectorsService,
    OAuthClientRegistrationService,
    RemoteMcpService,
  ],
  exports: [RemoteMcpService],
})
export class ConnectorsModule {}
