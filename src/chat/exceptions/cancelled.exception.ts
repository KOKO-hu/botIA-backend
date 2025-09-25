import { HttpException, HttpStatus } from '@nestjs/common';

export class RequestCancelledException extends HttpException {
  constructor(sessionId: string) {
    super(
      {
        message: 'Requête annulée par l\'utilisateur',
        sessionId,
        cancelled: true,
        statusCode: HttpStatus.REQUEST_TIMEOUT,
      },
      HttpStatus.REQUEST_TIMEOUT,
    );
  }
}
