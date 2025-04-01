import { DurableObject } from "cloudflare:workers"
import { Hono } from "hono"
import { cors } from "hono/cors"

type Env = {
    Bindings: {
        MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>
    }
}

export class MyDurableObject extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env)
    }

    // Websocket related

    async fetch(request: Request): Promise<Response> {
        const websocketPair = new WebSocketPair()
        const [client, server] = Object.values(websocketPair)
        this.ctx.acceptWebSocket(server)
        return new Response(null, { status: 101, webSocket: client })
    }

    async webSocketOpen(ws: WebSocket) {
        ws.send(JSON.stringify({ welcome: "Welcome!" }))
    }

    async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
        console.log("got message", message, typeof message)
        await this.broadcastUsers()
        const hello = await this.sayHello()
        ws.send(JSON.stringify({ hello }))
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
        console.log("got a close event", code, reason, wasClean)
        ws.close(code, "Durable Object is closing WebSocket")
        setTimeout(() => {
            this.broadcastUsers()
        }, 500)
    }

    async broadcastUsers(diff: number = 0) {
        const n_connections = this.ctx.getWebSockets().length + diff
        for (const connection of this.ctx.getWebSockets()) {
            connection.send(JSON.stringify({ users: n_connections }))
        }
    }

    async broadcastHello() {
        const hello = await this.sayHello()
        for (const connection of this.ctx.getWebSockets()) {
            connection.send(JSON.stringify({ hello }))
        }
    }

    // Storage related

    async setName(value: string): Promise<void> {
        await this.ctx.storage.put("name", value)
        await this.broadcastHello()
    }

    async getName(): Promise<string> {
        return (await this.ctx.storage.get("name")) || "World"
    }

    async setGreeting(value: string): Promise<void> {
        await this.ctx.storage.put("greeting", value)
        await this.broadcastHello()
    }

    async getGreeting(): Promise<string> {
        return (await this.ctx.storage.get("greeting")) || "Hello"
    }

    // Main hello

    async sayHello(name?: string): Promise<string> {
        const greeting = await this.getGreeting()
        if (!name) name = await this.getName()
        return `${greeting}, ${name}!`
    }
}

const app = new Hono<Env>()

app.get("/ws", async (c) => {
    if (c.req.header("upgrade") !== "websocket") {
        return c.text("Expected websocket request", 426)
    }
    const id = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    return stub.fetch(c.req.raw)
})

app.use(
    "*",
    cors({
        origin: ["http://localhost:5173", "https://durable-object-frontend.pages.dev"],
        allowHeaders: ["Origin", "Content-Type", "Authorization"],
        allowMethods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
        credentials: true,
    })
)

app.get("/", async (c) => {
    const name = c.req.query("name")
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const greeting = await stub.sayHello(name)

    return c.text(greeting)
})

app.get("/greeting", async (c) => {
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const greeting = await stub.getGreeting()

    return c.text(greeting)
})

app.post("/greeting", async (c) => {
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const greeting = await c.req.text()
    await stub.setGreeting(greeting)

    return c.text(`Set greeting to "${greeting}"`)
})

app.post("/name", async (c) => {
    const id: DurableObjectId = c.env.MY_DURABLE_OBJECT.idFromName("foo")
    const stub = c.env.MY_DURABLE_OBJECT.get(id)
    const name = await c.req.text()
    await stub.setName(name)

    return c.text(`Set name to "${name}"`)
})

export default app
