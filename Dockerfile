# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY RadikalPlayers.csproj ./
RUN dotnet restore RadikalPlayers.csproj

COPY . .
RUN dotnet publish RadikalPlayers.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

ENV ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_RUNNING_IN_CONTAINER=true

COPY --from=build /app/publish .

# Render inyecta PORT (10000 por defecto). La app lo lee y escucha en 0.0.0.0.
RUN mkdir -p /app/App_Data /var/data
EXPOSE 10000

ENTRYPOINT ["dotnet", "RadikalPlayers.dll"]
