namespace RadikalPlayers.Radikal;

public sealed record ShopPriceGroupDto(
    int ProductTypeId,
    int ProductSubTypeId,
    string DistributorId,
    int ProductId,
    int CountryCode,
    int VatTypeId,
    int PriceGroupId,
    bool ApiManaged);

public sealed record ShopMediaDto(string Type, string Url, string? PreviewUrl);

public sealed record ShopProductDto(
    int Id,
    string Title,
    string? Description,
    string? ImageUrl,
    int? Points,
    decimal? Price,
    string? Category,
    string Url,
    ShopPriceGroupDto? PriceGroup,
    IReadOnlyList<ShopMediaDto>? Media = null);

public sealed record ShopCategoryDto(
    int Id,
    string Name,
    IReadOnlyList<ShopProductDto> Products);

public sealed record ShopDto(
    IReadOnlyList<ShopCategoryDto> Categories,
    DateTimeOffset FetchedAt);

public sealed record ShopCartMoneyDto(int Points, decimal Euros)
{
    public bool IsEmpty => Points == 0 && Euros == 0;
}

public sealed record ShopCartLineDto(
    long LineId,
    int ProductId,
    string Title,
    string? Description,
    string? ImageUrl,
    string? ProductUrl,
    int Quantity,
    ShopCartMoneyDto UnitPrice,
    ShopCartMoneyDto Total,
    ShopPriceGroupDto? PriceGroup);

public sealed record ShopCartDto(
    long? CartId,
    IReadOnlyList<ShopCartLineDto> Lines,
    ShopCartMoneyDto Subtotal,
    ShopCartMoneyDto Total,
    DateTimeOffset FetchedAt);

public sealed record ShopCartAddRequest(int ProductId, int Quantity = 1);

public sealed record ShopCartQuantityRequest(int Quantity);

public sealed class ShopCartException : Exception
{
    public ShopCartException(string message) : base(message)
    {
    }
}
