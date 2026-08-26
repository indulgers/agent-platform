import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { ConnectorsController, ConnectorCallbacksController } from './connectors.controller'
import { ConnectorsService } from './connectors.service'
import { OAuthClientRegistrationService } from './oauth-client-registration.service'
import {
  REMOTE_MCP_CLIENT_FACTORY,
  RemoteMcpService,
  SdkRemoteMcpClientFactory,
} from './remote-mcp.service'
import { ConnectorOAuthProtocol } from './connector-oauth-protocol'

@Module({
  imports: [PrismaModule],
  controllers: [ConnectorsController, ConnectorCallbacksController],
  providers: [
    ConnectorsService,
    OAuthClientRegistrationService,
    ConnectorOAuthProtocol,
    RemoteMcpService,
    { provide: REMOTE_MCP_CLIENT_FACTORY, useClass: SdkRemoteMcpClientFactory },
  ],
  exports: [RemoteMcpService],
})
export class ConnectorsModule {}
