abstract class Logger {
    public abstract debug(message: string);
    public abstract info(message: string, infoObj?: any);
    public abstract warning(message: string);
    public abstract error(message: string, error?: any);
}

export class ConsoleLogger extends Logger {
    debug(message: string) {
        console.debug(`${message}`);
    }

    info(message: string) {
        console.info(`${message}`);
    }

    warning(message: string) {
        console.warn(`${message}`);
    }

    error(message: string, error: Error) {
        console.info(`${message}`);
        if (error) {
            console.log(error);
        }
    }
}

export default Logger;