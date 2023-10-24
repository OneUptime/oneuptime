# Docker file to run this dot net project
FROM mcr.microsoft.com/dotnet/sdk:6.0
WORKDIR /app

COPY . ./

RUN dotnet build

EXPOSE 7856

ENTRYPOINT ["dotnet", "run", "--urls=http://localhost:7856/"]

